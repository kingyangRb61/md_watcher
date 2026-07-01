#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/.python:$SCRIPT_DIR/.python/Scripts:$PATH"
python "$SCRIPT_DIR/app.py"
