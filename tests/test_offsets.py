import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lt import normalize

TEXT = "El otro dia fui a la tienda \U0001F389 y compre un ejmplio; despues volvi."


def js_slice(text, a, b):
    raw = text.encode("utf-16-le")
    return raw[2 * a:2 * b].decode("utf-16-le", "replace")


def lt_payload(text):
    spans = [("dia", "día"), ("compre", "compré"), ("ejmplio", "ejemplo")]
    matches = []
    for frag, rep in spans:
        cp = text.index(frag)
        off = len(text[:cp].encode("utf-16-le")) // 2
        matches.append({
            "offset": off,
            "length": len(frag),
            "message": frag,
            "replacements": [{"value": rep}],
            "context": {"text": text, "offset": off},
            "rule": {"id": "TEST", "issueType": "misspelling"},
        })
    return {"matches": matches}


class OffsetTests(unittest.TestCase):
    def test_utf16_shift_after_emoji(self):
        matches, dropped = normalize(TEXT, lt_payload(TEXT))
        self.assertEqual(dropped, 0)
        self.assertEqual(len(matches), 3)
        for m in matches:
            self.assertEqual(TEXT[m["start"]:m["end"]], m["frag"])
            self.assertEqual(js_slice(TEXT, m["s16"], m["e16"]), m["frag"])

    def test_cp_and_utf16_differ_after_emoji(self):
        matches, _ = normalize(TEXT, lt_payload(TEXT))
        comp = next(m for m in matches if m["frag"] == "compre")
        self.assertEqual(comp["s16"] - comp["start"], 1)

    def test_no_op_suggestion_dropped(self):
        payload = {"matches": [{
            "offset": 0, "length": 3, "message": "x",
            "replacements": [{"value": "El "}],
            "context": {"text": "El otro", "offset": 0},
            "rule": {"id": "NOOP", "issueType": "misspelling"},
        }]}
        matches, dropped = normalize("El otro", payload)
        self.assertEqual(matches, [])
        self.assertEqual(dropped, 1)


if __name__ == "__main__":
    unittest.main()
