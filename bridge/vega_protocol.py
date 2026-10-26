"""Пакеты VEGA: little-endian, как в описании BLE-логгера."""

import struct

VEGA_SERVICE = "55865178-6434-3234-1251-136459739abb"
OUTPUT_UUID = "55865178-6434-3234-1251-13645973aa01"
INPUT_UUID = "55865178-6434-3234-1251-13645973aa02"
MYO_READ_UUID = "55865178-6434-3234-1251-13645973aa03"
MYO_WRITE_UUID = "55865178-6434-3234-1251-13645973aa04"
SERIAL_UUID = "55865178-6434-3234-1251-13645973aa07"

BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"
DIS_SERIAL_UUID = "00002a25-0000-1000-8000-00805f9b34fb"
DIS_FIRMWARE_UUID = "00002a26-0000-1000-8000-00805f9b34fb"
DIS_HARDWARE_UUID = "00002a27-0000-1000-8000-00805f9b34fb"
DIS_SOFTWARE_UUID = "00002a28-0000-1000-8000-00805f9b34fb"
DIS_MANUFACTURER_UUID = "00002a29-0000-1000-8000-00805f9b34fb"

OUTPUT_LEN = 62
INPUT_LEN = 41
MYO_LEN = 30

USER_MODE = 0x22
SERVICE_MODE = 0x21
MANUAL_MYO_MODE = 0x24
ADVANCED_MYO_MODE = 0x31
LOW_BATTERY_MODE = 0x28

MYO_KEYS = (
    "dir_treshold",
    "TrigPercentTreshold",
    "TriggerBlocks",
    "TrigTresholdHigh",
    "TrigTresholdLow",
    "DifTriggerPlus",
    "DifTriggerMinus",
    "TrigDelayMax",
    "DifTrDelayMinus",
    "DifMovePlus",
    "DifMoveMinus",
    "MoveTresholdHigh",
    "MoveBlocks",
    "dead_Zone_Myo1",
    "dead_Zone_Myo2",
)

MYO_DEFAULTS = {
    "dir_treshold": 105,
    "TrigPercentTreshold": 2,
    "TriggerBlocks": 50,
    "TrigTresholdHigh": 945,
    "TrigTresholdLow": 819,
    "DifTriggerPlus": 50,
    "DifTriggerMinus": 6,
    "TrigDelayMax": 945,
    "DifTrDelayMinus": 1,
    "DifMovePlus": 3,
    "DifMoveMinus": 2,
    "MoveTresholdHigh": 315,
    "MoveBlocks": 20,
    "dead_Zone_Myo1": 250,
    "dead_Zone_Myo2": 250,
}

GRIPS = (
    "Раскрытая ладонь",
    "Нейтральный схват",
    "Силовой схват",
    "Кулачный схват",
    "Схват удержания чашки",
    "Удерживающий схват",
    "Цилиндрический схват",
    "Плоская ладонь",
    "Схват для нажатия",
    "Указательный жест",
    "Схват удержания карты",
    "Трехпалый щепоть",
    "Двухпалый щепоть",
    "Боковой схват",
    "Закрытый схват",
    "Пользовательский схват №1",
    "Пользовательский схват №2",
)

ERRORS = {
    0: "",
    1: "Нет связи с контроллером протеза",
    2: "Нет связи BLE",
    3: "Ошибка модуля индикации",
    4: "Ошибка АЦП 1",
    5: "Ошибка АЦП 2",
    6: "Неисправность аккумулятора",
    7: "Неисправность миодатчика 1",
    8: "Неисправность миодатчика 2",
    9: "Неисправность пальца 1",
    10: "Неисправность пальца 2",
    11: "Неисправность пальца 3",
    12: "Неисправность пальца 4",
    13: "Неисправность пальца 5",
    14: "Неисправность пальца 6",
    78: "Ошибка памяти протеза",
    84: "Неисправны оба миодатчика",
    85: "Ошибка подтверждения конфигурации",
}


def grip_name(number):
    if 0 <= number < len(GRIPS):
        return GRIPS[number]
    return "Схват %d" % number


def error_text(code):
    if code in ERRORS:
        return ERRORS[code]
    if code:
        return "Код ошибки %d" % code
    return ""


def _u16(value):
    number = int(value)
    if number < 0 or number > 65535:
        raise ValueError("значение вне диапазона 0...65535")
    return number


def _k(value):
    number = round(float(value), 1)
    if number < 0 or number > 1:
        raise ValueError("коэффициент миодатчика должен быть от 0.0 до 1.0")
    return number


def unpack_output(data):
    raw = bytes(data)
    if len(raw) != OUTPUT_LEN:
        raise ValueError("телеметрия должна быть %d байт, пришло %d" % (OUTPUT_LEN, len(raw)))
    state, grip, error, myo_mode, trig = struct.unpack_from("<BBBbB", raw, 0)
    motors = list(struct.unpack_from("<6B", raw, 5))
    custom1_speed = list(struct.unpack_from("<6b", raw, 11))
    custom1_pos = list(struct.unpack_from("<6b", raw, 17))
    custom2_speed = list(struct.unpack_from("<6b", raw, 23))
    custom2_pos = list(struct.unpack_from("<6b", raw, 29))
    myo1, myo2 = struct.unpack_from("<HH", raw, 35)
    currents = list(struct.unpack_from("<6h", raw, 39))
    vbat, = struct.unpack_from("<H", raw, 51)
    k1, k2 = struct.unpack_from("<ff", raw, 53)
    secure, = struct.unpack_from("<B", raw, 61)
    return {
        "state": state,
        "grip": grip,
        "gripName": grip_name(grip),
        "error": error,
        "errorText": error_text(error),
        "myoMode": myo_mode,
        "trigger": trig,
        "motors": motors,
        "custom1Speed": custom1_speed,
        "custom1Pos": custom1_pos,
        "custom2Speed": custom2_speed,
        "custom2Pos": custom2_pos,
        "myo1": myo1,
        "myo2": myo2,
        "currents": currents,
        "vbat": vbat,
        "k1": round(k1, 1),
        "k2": round(k2, 1),
        "connectionMode": secure,
        "mode": "user" if secure else "service",
        "lowBattery": state == LOW_BATTERY_MODE,
    }


def _six(values):
    items = [int(value) for value in list(values or [])][:6]
    return items + [0] * (6 - len(items))


def pack_input(state, source, k1=None, k2=None):
    source = source or {}
    grip = int(source.get("grip") or 0) & 0xFF
    myo_mode = int(source.get("myoMode") or 0)
    c1s = _six(source.get("custom1Speed"))
    c1p = _six(source.get("custom1Pos"))
    c2s = _six(source.get("custom2Speed"))
    c2p = _six(source.get("custom2Pos"))
    coefficient1 = _k(source.get("k1") if k1 is None else k1)
    coefficient2 = _k(source.get("k2") if k2 is None else k2)
    packet = struct.pack(
        "<BBb6b6b6b6b6bff",
        int(state) & 0xFF,
        grip,
        myo_mode if -128 <= myo_mode <= 127 else 0,
        *([0] * 6),
        *[int(v) for v in c1s[:6]],
        *[int(v) for v in c1p[:6]],
        *[int(v) for v in c2s[:6]],
        *[int(v) for v in c2p[:6]],
        coefficient1,
        coefficient2,
    )
    if len(packet) != INPUT_LEN:
        raise ValueError("команда собралась в %d байт" % len(packet))
    return packet


def unpack_myo(data):
    raw = bytes(data)
    if len(raw) != MYO_LEN:
        raise ValueError("настройки миодатчиков должны быть %d байт, пришло %d" % (MYO_LEN, len(raw)))
    values = struct.unpack("<15H", raw)
    return {key: values[index] for index, key in enumerate(MYO_KEYS)}


def pack_myo(values):
    merged = dict(MYO_DEFAULTS)
    if values:
        merged.update(values)
    packet = struct.pack("<15H", *[_u16(merged[key]) for key in MYO_KEYS])
    if len(packet) != MYO_LEN:
        raise ValueError("пакет настроек собрался в %d байт" % len(packet))
    return packet


def decode_text(data):
    if not data:
        return ""
    return bytes(data).split(b"\x00", 1)[0].decode("utf-8", "replace").strip()
