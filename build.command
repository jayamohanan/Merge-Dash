#!/bin/sh
# Double-click in Finder: builds the game into build/.
# Not part of the game build (build.sh excludes it).

# Finder starts .command files in the home folder — run from this project instead.
cd "$(dirname "$0")" || exit 1

sh build.sh
status=$?

echo
if [ $status -eq 0 ]; then echo "Done."; else echo "FAILED (exit code $status)."; fi
# Keep the Terminal window open so the result can be read.
printf "Press any key to close..."
read -r -n 1 _ 2>/dev/null || read -r _
