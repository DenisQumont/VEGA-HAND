import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from vega_protocol import INPUT_LEN, MYO_LEN, OUTPUT_LEN, pack_input, pack_myo, unpack_myo, unpack_output


def test_output_roundtrip_layout():
    raw = bytearray(OUTPUT_LEN)
    raw[0] = 1
    raw[1] = 13
    raw[2] = 7
    raw[4] = 1
    struct.pack_into("<HH", raw, 35, 1200, 800)
    struct.pack_into("<ff", raw, 53, 0.4, 1.0)
    raw[61] = 1
    packet = unpack_output(raw)
    assert packet["gripName"] == "Боковой схват"
    assert packet["errorText"] == "Неисправность миодатчика 1"
    assert packet["trigger"] == 1
    assert packet["myo1"] == 1200
    assert packet["k1"] == 0.4
    assert packet["k2"] == 1.0
    assert packet["mode"] == "user"


def test_input_is_41_le():
    packet = pack_input(0x22, {"grip": 2, "k1": 0.5, "k2": 0.5, "myoMode": 1})
    assert len(packet) == INPUT_LEN
    assert packet[0] == 0x22
    assert packet[1] == 2
    assert packet[3:9] == b"\x00" * 6
    k1, k2 = struct.unpack_from("<ff", packet, 33)
    assert k1 == 0.5 and k2 == 0.5


def test_myo_defaults_and_override():
    packet = pack_myo({"dir_treshold": 200, "dead_Zone_Myo2": 10})
    assert len(packet) == MYO_LEN
    values = unpack_myo(packet)
    assert values["dir_treshold"] == 200
    assert values["TrigPercentTreshold"] == 2
    assert values["dead_Zone_Myo2"] == 10
    assert values["TrigTresholdHigh"] == 945


def test_rejects_bad_sizes():
    try:
        unpack_output(b"\x00" * 10)
    except ValueError:
        pass
    else:
        raise AssertionError("короткая телеметрия должна отклоняться")
    try:
        pack_myo({"dir_treshold": 70000})
    except ValueError:
        pass
    else:
        raise AssertionError("значение вне uint16 должно отклоняться")


if __name__ == "__main__":
    test_output_roundtrip_layout()
    test_input_is_41_le()
    test_myo_defaults_and_override()
    test_rejects_bad_sizes()
    print("ok")
