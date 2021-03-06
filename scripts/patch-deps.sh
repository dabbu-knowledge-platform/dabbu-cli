#!/bin/bash

# patch-deps
# Patches any dependencies that break the build

# Fail fast
set -e

# ANSI colour codes so we can highlight text in the terminal
colour_red="\033[0;31m"
colour_green="\033[0;32m"
colour_blue="\033[0;34m"
colour_cyan="\033[0;36m"

# Escape codes for making text bold and returning it back to normal
bold="\e[1m"
normal="\e[0m"

# Apply patches
patch --forward node_modules/universalify/index.js < patches/universalify-undefined-fn.patch
