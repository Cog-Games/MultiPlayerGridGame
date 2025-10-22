#!/usr/bin/env node
// Strip outputs from a Jupyter notebook to make it lighter/easier to open.
// Usage: node strip_ipynb_outputs.cjs <input.ipynb> <output.ipynb>

const fs = require('fs');

function stripNotebook(nb) {
  if (!nb || !Array.isArray(nb.cells)) return nb;
  nb = JSON.parse(JSON.stringify(nb));
  nb.cells = nb.cells.map((cell) => {
    if (cell && cell.cell_type === 'code') {
      cell.outputs = [];
      cell.execution_count = null;
      if (cell.metadata) {
        // Remove execution-related metadata if present
        delete cell.metadata.execution;
        delete cell.metadata.execution_count;
        delete cell.metadata.collapsed;
      }
    }
    return cell;
  });
  return nb;
}

function main() {
  const [,, inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error('Usage: node strip_ipynb_outputs.cjs <input.ipynb> <output.ipynb>');
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(inPath, 'utf8');
    const nb = JSON.parse(raw);
    const cleaned = stripNotebook(nb);
    fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 1));
    console.log(`Wrote cleaned notebook: ${outPath}`);
  } catch (e) {
    console.error('Failed to process notebook:', e.message);
    process.exit(2);
  }
}

if (require.main === module) main();
