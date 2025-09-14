import json
import re
from pathlib import Path


def find_first_use_index(cells, name: str):
    pattern = re.compile(rf"\b{name}\b")
    for i, c in enumerate(cells):
        if c.get("cell_type") != "code":
            continue
        src = "".join(c.get("source", []))
        if pattern.search(src):
            return i
    return None


def has_definition_before(cells, name: str, end_index: int):
    assign_re = re.compile(rf"^\s*{re.escape(name)}\s*=", re.MULTILINE)
    for c in cells[: max(0, end_index)]:
        if c.get("cell_type") != "code":
            continue
        src = "".join(c.get("source", []))
        if assign_re.search(src):
            return True
    return False


def extract_existing_order(cells):
    assign_re = re.compile(
        r"game_type_order\s*=\s*\[(.*?)\]", re.DOTALL
    )
    for c in cells:
        if c.get("cell_type") != "code":
            continue
        src = "".join(c.get("source", []))
        m = assign_re.search(src)
        if m:
            # Build a sanitized list from the literal content
            content = "[" + m.group(1) + "]"
            try:
                value = json.loads(content.replace("'", '"'))
                if isinstance(value, list) and all(isinstance(x, str) for x in value):
                    return value
            except Exception:
                pass
    return None


def ensure_cell(path: Path) -> None:
    with path.open("r", encoding="utf-8") as f:
        nb = json.load(f)

    cells = nb.get("cells", [])
    first_use = find_first_use_index(cells, "game_type_order")
    if first_use is None:
        print("No usage of game_type_order found; no changes made.")
        return

    if has_definition_before(cells, "game_type_order", first_use):
        print("Definition already exists before first use; no changes made.")
        return

    existing = extract_existing_order(cells)
    default_order = existing or [
        "human",
        "gpt-4.1-mini",
        "individual_rl",
        "joint_rl",
    ]

    src = (
        "# Ensure game_type_order and labels are defined early for downstream cells\n"
        "try:\n"
        "    game_type_order\n"
        "except NameError:\n"
        f"    game_type_order = {json.dumps(default_order)}\n"
        "\n"
        "try:\n"
        "    game_type_labels\n"
        "except NameError:\n"
        "    _pretty = {\n"
        "        'human': 'Human',\n"
        "        'gpt-4.1-mini': 'GPT-4.1-mini',\n"
        "        'individual_rl': 'Individual RL',\n"
        "        'joint_rl': 'Joint RL',\n"
        "    }\n"
        "    game_type_labels = [_pretty.get(gt, gt) for gt in game_type_order]\n"
    )

    new_cell = {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {"tags": ["auto-inserted"]},
        "outputs": [],
        "source": [line + ("\n" if not line.endswith("\n") else "") for line in src.split("\n") if line != ""],
    }

    # If an auto-inserted cell already exists, update it; else insert before first use
    updated = False
    for i, c in enumerate(cells):
        if c.get("cell_type") == "code" and "auto-inserted" in c.get("metadata", {}).get("tags", []):
            nb["cells"][i] = new_cell
            updated = True
            print(f"Updated existing auto-inserted cell at index {i}.")
            break

    if not updated:
        insert_at = max(0, first_use)
        nb["cells"] = cells[:insert_at] + [new_cell] + cells[insert_at:]
        print(f"Inserted game_type_order definition cell at index {insert_at}.")

    with path.open("w", encoding="utf-8") as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)
        f.write("\n")

    


if __name__ == "__main__":
    p = Path("dataAnalysis/merged_collaboration_analysis_complete.ipynb")
    ensure_cell(p)
