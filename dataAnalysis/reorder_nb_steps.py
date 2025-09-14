import json
import re
from pathlib import Path


def extract_step_number(cell):
    if cell.get("cell_type") != "markdown":
        return None
    src = "".join(cell.get("source", []))
    for line in src.splitlines():
        m = re.match(r"^##\s*Step\s*(\d+)\s*:\s*", line.strip(), re.IGNORECASE)
        if m:
            return int(m.group(1))
    return None


def reorder_notebook(path: Path) -> None:
    with path.open("r", encoding="utf-8") as f:
        nb = json.load(f)

    cells = nb.get("cells", [])

    # Find all step header cells and their indices
    step_headers = []  # list of (index, step_number)
    for i, c in enumerate(cells):
        step_num = extract_step_number(c)
        if step_num is not None:
            step_headers.append((i, step_num))

    if not step_headers:
        print("No step headers found. No changes made.")
        return

    # Build segments: from each step header to the next step header (exclusive)
    segments = []  # list of (step_number, [cells...])
    for idx, (start_i, step_num) in enumerate(step_headers):
        end_i = step_headers[idx + 1][0] if idx + 1 < len(step_headers) else len(cells)
        segment_cells = cells[start_i:end_i]
        segments.append((step_num, segment_cells))

    # Preserve any prefix cells that appear before the first step header
    prefix_cells = cells[: step_headers[0][0]] if step_headers[0][0] > 0 else []

    # Sort segments by step number ascending
    segments.sort(key=lambda x: x[0])

    # Reassemble cells
    new_cells = []
    new_cells.extend(prefix_cells)
    for step_num, seg in segments:
        new_cells.extend(seg)

    if new_cells == cells:
        print("Notebook already in correct order; no changes written.")
        return

    nb["cells"] = new_cells

    # Write back to the same file (in-place)
    with path.open("w", encoding="utf-8") as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)
        f.write("\n")

    # Report summary
    print("Reordered notebook by step numbers. Steps found:")
    print(", ".join(str(s) for _, s in step_headers))
    print("New order:")
    print(", ".join(str(s) for s, _ in segments))


if __name__ == "__main__":
    p = Path("dataAnalysis/merged_collaboration_analysis_complete.ipynb")
    reorder_notebook(p)

