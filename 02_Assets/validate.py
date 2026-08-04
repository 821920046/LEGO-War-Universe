#!/usr/bin/env python3
"""LWU asset database validator.

Usage:
    python3 validate.py            # validates ./assets.json against ./assets.schema.json
    python3 validate.py path.json  # validate a specific file

Runs structural checks even without the optional 'jsonschema' package:
  - valid JSON
  - unique IDs across the whole database
  - ID naming pattern (PREFIX-NNN)
  - every asset has non-empty 'lines'
  - defaultColorGrade points to a real color grade
  - vehicles have a valid 'class'
  - referenced variant ids exist in the variant presets
If 'jsonschema' is installed, also runs full JSON Schema validation.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ID_RE = re.compile(r"^[A-Z]{2,5}-[0-9]{3}$")
VEHICLE_CLASSES = {"ground", "aircraft", "helicopter", "ship", "drone", "ugv"}
ASSET_ARRAYS = ["characters", "vehicles", "weapons", "props", "fx",
                "environments", "cameras", "lighting", "colorGrades", "audio"]


def main():
    data_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "assets.json")
    schema_path = os.path.join(HERE, "assets.schema.json")
    errors, warnings = [], []

    try:
        with open(data_path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print("FAIL: cannot parse JSON:", e)
        sys.exit(1)

    seen = {}
    variant_ids = {v["id"] for v in data.get("variantPresets", [])}
    char_variant_ids = {v["id"] for v in data.get("characterVariantPresets", [])}
    color_ids = {c["id"] for c in data.get("colorGrades", [])}

    for arr in ASSET_ARRAYS:
        for a in data.get(arr, []):
            aid = a.get("id", "<missing>")
            if aid in seen:
                errors.append(f"duplicate id {aid} (in {arr} and {seen[aid]})")
            seen[aid] = arr
            if not ID_RE.match(aid):
                errors.append(f"bad id pattern: {aid} in {arr}")
            if not a.get("lines"):
                errors.append(f"{aid}: empty or missing lines")
            if arr == "vehicles" and a.get("class") not in VEHICLE_CLASSES:
                errors.append(f"{aid}: invalid vehicle class {a.get('class')!r}")
            for vid in a.get("variants", []):
                if vid not in variant_ids and vid not in char_variant_ids:
                    warnings.append(f"{aid}: variant '{vid}' not found in presets")

    dcg = data.get("defaultColorGrade")
    if dcg and dcg not in color_ids:
        errors.append(f"defaultColorGrade {dcg} is not a real colorGrade id")

    # Optional full schema validation
    try:
        import jsonschema  # type: ignore
        with open(schema_path, encoding="utf-8") as f:
            schema = json.load(f)
        jsonschema.validate(data, schema)
        print("jsonschema: full schema validation PASSED")
    except ImportError:
        print("jsonschema not installed - ran structural checks only (pip install jsonschema for full validation)")
    except Exception as e:
        errors.append(f"schema validation error: {e}")

    total = sum(len(data.get(a, [])) for a in ASSET_ARRAYS)
    for w in warnings:
        print("WARN:", w)
    if errors:
        for e in errors:
            print("ERROR:", e)
        print(f"\nFAIL: {len(errors)} error(s), {total} assets checked.")
        sys.exit(1)
    print(f"OK: {total} assets, all IDs unique and well-formed. schemaVersion={data.get('schemaVersion')}")


if __name__ == "__main__":
    main()
