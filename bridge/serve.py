"""Локальный BLE-мост VEGA.

Страницы PWA по-прежнему открываются на http://127.0.0.1:8091.
Этот процесс держит Bleak и отдаёт телеметрию по WebSocket на порт 8092.

В пользовательском режиме протез ждёт защищённое сопряжение телефона.
Подключение с компьютера доступно в сервисном режиме.
"""

import asyncio
import json
import sys

from bleak import BleakClient, BleakScanner
import websockets

from vega_protocol import (
    ADVANCED_MYO_MODE,
    BATTERY_UUID,
    DIS_FIRMWARE_UUID,
    DIS_HARDWARE_UUID,
    DIS_MANUFACTURER_UUID,
    DIS_SOFTWARE_UUID,
    INPUT_UUID,
    MANUAL_MYO_MODE,
    MYO_READ_UUID,
    MYO_WRITE_UUID,
    OUTPUT_UUID,
    SERIAL_UUID,
    SERVICE_MODE,
    USER_MODE,
    VEGA_SERVICE,
    decode_text,
    pack_input,
    pack_myo,
    unpack_myo,
    unpack_output,
)

WS_HOST = "0.0.0.0"
WS_PORT = 8092


class Bridge:
    def __init__(self):
        self.sockets = set()
        self.client = None
        self.name = ""
        self.address = ""
        self.telemetry = None
        self.info = {}
        self.lock = asyncio.Lock()
        self._last_emit = 0.0

    def status(self, reason):
        connected = self.client is not None and self.client.is_connected
        mode = None
        if self.telemetry:
            mode = self.telemetry.get("mode")
        return {
            "event": "status",
            "reason": reason,
            "bridge": True,
            "connected": connected,
            "name": self.name,
            "address": self.address,
            "mode": mode,
        }

    async def broadcast(self, message):
        if not self.sockets:
            return
        raw = json.dumps(message, ensure_ascii=False)
        dead = []
        for socket in list(self.sockets):
            try:
                await socket.send(raw)
            except Exception:
                dead.append(socket)
        for socket in dead:
            self.sockets.discard(socket)

    async def scan(self):
        found = await BleakScanner.discover(timeout=4.0, return_adv=True)
        devices = []
        for address, pair in found.items():
            device, adv = pair
            name = device.name or adv.local_name or ""
            uuids = [item.lower() for item in (adv.service_uuids or [])]
            if not name.upper().startswith("VEGA") and VEGA_SERVICE not in uuids:
                continue
            devices.append({
                "name": name or "VEGA",
                "address": address,
                "rssi": adv.rssi,
            })
        devices.sort(key=lambda item: item["rssi"] if item["rssi"] is not None else -999, reverse=True)
        await self.broadcast({"event": "devices", "devices": devices})

    async def connect(self, address):
        async with self.lock:
            await self._disconnect(quiet=True)
            client = BleakClient(address)
            try:
                await client.connect()
            except Exception as exc:
                await self.broadcast({
                    "event": "error",
                    "message": "Не удалось подключиться: %s" % exc,
                })
                await self.broadcast(self.status("connect"))
                return
            self.client = client
            self.address = address
            self.name = client.address or address
            try:
                if hasattr(client, "pair"):
                    await client.pair()
            except Exception:
                pass
            try:
                self.name = client.name or self.name
            except Exception:
                pass
            client.set_disconnected_callback(self._on_drop)
            try:
                await client.start_notify(OUTPUT_UUID, self._on_notify)
            except Exception as exc:
                await self._disconnect(quiet=True)
                await self.broadcast({
                    "event": "error",
                    "message": "Протез не отдал телеметрию. В пользовательском режиме подключение с компьютера недоступно, нужен сервисный режим. %s" % exc,
                })
                await self.broadcast(self.status("connect"))
                return
            await self.broadcast(self.status("connect"))
            await self._read_info()
            await self.read_myo()

    def _on_drop(self, _client):
        self.client = None
        self.telemetry = None
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(self.status("disconnect")))
        except RuntimeError:
            pass

    def _on_notify(self, _handle, data):
        try:
            packet = unpack_output(data)
        except ValueError:
            return
        self.telemetry = packet
        loop = asyncio.get_running_loop()
        loop.create_task(self._emit_telemetry(packet))

    async def _emit_telemetry(self, packet):
        loop = asyncio.get_running_loop()
        now = loop.time()
        if now - self._last_emit < 0.05:
            return
        self._last_emit = now
        message = {"event": "telemetry"}
        message.update(packet)
        await self.broadcast(message)

    async def _read_char(self, uuid):
        if not self.client or not self.client.is_connected:
            return None
        try:
            return await self.client.read_gatt_char(uuid)
        except Exception:
            return None

    async def _read_info(self):
        info = {
            "event": "info",
            "serial": decode_text(await self._read_char(SERIAL_UUID)),
            "firmware": decode_text(await self._read_char(DIS_FIRMWARE_UUID)),
            "hardware": decode_text(await self._read_char(DIS_HARDWARE_UUID)),
            "software": decode_text(await self._read_char(DIS_SOFTWARE_UUID)),
            "manufacturer": decode_text(await self._read_char(DIS_MANUFACTURER_UUID)),
        }
        battery = await self._read_char(BATTERY_UUID)
        if battery:
            info["battery"] = battery[0]
        self.info = info
        await self.broadcast(info)

    async def read_myo(self):
        if not self.client or not self.client.is_connected:
            await self.broadcast({"event": "error", "message": "Протез не подключён"})
            return
        data = await self._read_char(MYO_READ_UUID)
        if not data:
            await self.broadcast({"event": "error", "message": "Протез не отдал тонкие настройки миодатчиков"})
            return
        try:
            values = unpack_myo(data)
        except ValueError as exc:
            await self.broadcast({"event": "error", "message": str(exc)})
            return
        await self.broadcast({"event": "myo", "values": values})

    async def write_myo(self, values):
        if not self.client or not self.client.is_connected:
            await self.broadcast({"event": "error", "message": "Протез не подключён"})
            return
        try:
            packet = pack_myo(values)
            command = pack_input(ADVANCED_MYO_MODE, self.telemetry)
        except ValueError as exc:
            await self.broadcast({"event": "error", "message": str(exc)})
            return
        async with self.lock:
            await self.client.write_gatt_char(INPUT_UUID, command, response=False)
            await self.client.write_gatt_char(MYO_WRITE_UUID, packet, response=False)
        await self.broadcast({"event": "myo", "values": unpack_myo(packet), "written": True})

    async def set_mode(self, mode):
        code = SERVICE_MODE if mode == "service" else USER_MODE
        if mode not in ("service", "user"):
            await self.broadcast({"event": "error", "message": "Неизвестный режим"})
            return
        if not self.client or not self.client.is_connected:
            await self.broadcast({"event": "error", "message": "Протез не подключён"})
            return
        packet = pack_input(code, self.telemetry)
        async with self.lock:
            await self.client.write_gatt_char(INPUT_UUID, packet, response=False)
        await self.broadcast({
            "event": "mode",
            "mode": mode,
            "message": "Команда отправлена. Протез перезагрузит BLE, связь может прерваться.",
        })

    async def set_k(self, sensor, value, k1, k2):
        if not self.client or not self.client.is_connected:
            await self.broadcast({"event": "error", "message": "Протез не подключён"})
            return
        current1 = k1
        current2 = k2
        if self.telemetry:
            if current1 is None:
                current1 = self.telemetry.get("k1", 1.0)
            if current2 is None:
                current2 = self.telemetry.get("k2", 1.0)
        if sensor == 1:
            current1 = value
        elif sensor == 2:
            current2 = value
        else:
            await self.broadcast({"event": "error", "message": "Неизвестный миодатчик"})
            return
        try:
            packet = pack_input(MANUAL_MYO_MODE, self.telemetry, current1 if current1 is not None else 1.0, current2 if current2 is not None else 1.0)
        except ValueError as exc:
            await self.broadcast({"event": "error", "message": str(exc)})
            return
        async with self.lock:
            await self.client.write_gatt_char(INPUT_UUID, packet, response=False)
        await self.broadcast({"event": "k", "k1": struct_k(packet, 33), "k2": struct_k(packet, 37)})

    async def _disconnect(self, quiet=False):
        client = self.client
        self.client = None
        self.telemetry = None
        if client is not None:
            try:
                await client.disconnect()
            except Exception:
                pass
        if not quiet:
            await self.broadcast(self.status("disconnect"))

    async def disconnect(self):
        async with self.lock:
            await self._disconnect(quiet=False)

    async def handle(self, socket, message):
        command = message.get("cmd")
        try:
            if command in ("hello", "status", None):
                await socket.send(json.dumps(self.status("hello"), ensure_ascii=False))
                if self.telemetry:
                    payload = {"event": "telemetry"}
                    payload.update(self.telemetry)
                    await socket.send(json.dumps(payload, ensure_ascii=False))
                if self.info:
                    await socket.send(json.dumps(self.info, ensure_ascii=False))
            elif command == "scan":
                await self.scan()
            elif command == "connect":
                await self.connect(message.get("address") or "")
            elif command == "disconnect":
                await self.disconnect()
            elif command == "mode":
                await self.set_mode(message.get("mode"))
            elif command == "read_myo":
                await self.read_myo()
            elif command == "write_myo":
                await self.write_myo(message.get("values") or {})
            elif command == "set_k":
                await self.set_k(
                    int(message.get("sensor") or 0),
                    message.get("value"),
                    message.get("k1"),
                    message.get("k2"),
                )
            else:
                await socket.send(json.dumps({"event": "error", "message": "Неизвестная команда"}, ensure_ascii=False))
        except Exception as exc:
            await socket.send(json.dumps({"event": "error", "message": str(exc)}, ensure_ascii=False))


def struct_k(packet, offset):
    import struct
    value, = struct.unpack_from("<f", packet, offset)
    return round(value, 1)


BRIDGE = Bridge()


async def handler(socket):
    BRIDGE.sockets.add(socket)
    try:
        await socket.send(json.dumps(BRIDGE.status("hello"), ensure_ascii=False))
        async for raw in socket:
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await socket.send(json.dumps({"event": "error", "message": "Некорректный запрос"}, ensure_ascii=False))
                continue
            await BRIDGE.handle(socket, message)
    finally:
        BRIDGE.sockets.discard(socket)


async def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("BLE-мост VEGA: ws://127.0.0.1:%d" % WS_PORT)
    print("Страницы: http://127.0.0.1:8091/index.html")
    async with websockets.serve(handler, WS_HOST, WS_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
