#!/bin/bash
# Run input examples live (Zetaris + Nightshift) and record responses so
# SAMPLE_MODE=true can replay them offline. Writes output_examples/ and keeps
# logs/trace-example-N.jsonl.
#   bash scripts/record-examples.sh        all three, fixtures rebuilt from scratch
#   bash scripts/record-examples.sh 2      just example 2, fixtures added to the existing set
set -euo pipefail
cd "$(dirname "$0")/.."
list="${*:-1 2 3}"
[ $# -eq 0 ] && rm -rf data/fixtures/zetaris data/fixtures/nightshift
for n in $list; do
  echo "[INFO] example_$n"
  rm -rf .state/hmem   # examples are independent: no remembered decisions leak between them
  ZETARIS_RECORD=true METERLESS_RECORD=true npx tsx --env-file=.env run.ts "input_examples/example_$n.json" "output_examples/example_$n.json" > /dev/null
  node -e "const r=require('./output_examples/example_$n.json');console.log('  ',r.status,r.execution_time_seconds+'s',r.models.join(','),(r.output?.recommendations||[]).map(x=>x.generic+':'+x.written_by).join(' '))"
done
# Coverage run: writes up every candidate item once, so sample mode can still write any item
# that moves into the brief after a buyer decision removes another.
if [ $# -eq 0 ]; then
  echo "[INFO] coverage"
  rm -rf .state/hmem
  ZETARIS_RECORD=true METERLESS_RECORD=true npx tsx --env-file=.env run.ts scripts/coverage.json /dev/null > /dev/null
fi
rm -rf .state/hmem   # leave the live app with a clean memory
