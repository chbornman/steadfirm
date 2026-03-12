#!/usr/bin/env bash
# Run all linters, type checkers, tests, and builds for all project components.
#
# Tasks within each step run in PARALLEL for speed. Steps run sequentially
# so that failures in earlier steps are visible before later steps start.
#
# Usage:
#   ./scripts/check-all.sh           # Progress + summary (default)
#   ./scripts/check-all.sh --verbose # Show full command output
#   ./scripts/check-all.sh --clean   # Full clean rebuild first
#
# Steadfirm components:
#   Rust workspace  — crates/backend, crates/app, crates/shared (cargo)
#   Web frontend    — web/ (bun + vite)
#   TS packages     — packages/shared, packages/ui, packages/theme (bun)
#   BetterAuth      — services/betterauth (bun)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Parse arguments
CLEAN_BUILD=false
VERBOSE=false
for arg in "$@"; do
    case $arg in
        --clean|-c)
            CLEAN_BUILD=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--verbose] [--clean]"
            echo ""
            echo "Options:"
            echo "  --verbose, -v  Show full command output"
            echo "  --clean, -c    Full clean rebuild (removes node_modules, target)"
            echo "  --help, -h     Show this help"
            exit 0
            ;;
    esac
done

# Result tracking
declare -A RESULTS
declare -A ERRORS
declare -A TIMES

# Temp directory for per-task logs and metadata (parallel-safe)
TMPDIR_CHECKS=$(mktemp -d)
trap "rm -rf $TMPDIR_CHECKS" EXIT

# Output helper - only print if verbose
vecho() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "$@"
    fi
}

# Progress indicator - always shown (one line per task)
progress() {
    local step="$1"
    local platform="$2"
    local tool="$3"
    printf "  ${DIM}[%s]${NC} %-18s %s\n" "$step" "$platform" "$tool"
}

# =============================================================================
# Parallel execution helpers
# =============================================================================

# Run a check as a background job with its own isolated log file.
# Usage: run_bg <key> <cmd> <dir>
#   Then capture PID with: PIDS+=("key:$!")
run_bg() {
    local key="$1"
    local cmd="$2"
    local dir="$3"
    local logfile="$TMPDIR_CHECKS/${key}.log"
    local metafile="$TMPDIR_CHECKS/${key}.meta"

    (
        cd "$dir" || exit 1
        local cmd_start
        cmd_start=$(date +%s)
        if eval "$cmd" > "$logfile" 2>&1; then
            echo "status=passed" > "$metafile"
        else
            echo "status=failed" > "$metafile"
            local errs
            # For format checks, show which files have diffs
            if [[ "$key" == *"fmt"* ]]; then
                errs=$(grep "^Diff in " "$logfile" | head -5)
            else
                errs=$(grep -iE "error|failed|FAIL" "$logfile" | grep -v "0 error" | grep -v "FAILED:  0" | head -5)
            fi
            echo "errors<<ERREOF" >> "$metafile"
            echo "$errs" >> "$metafile"
            echo "ERREOF" >> "$metafile"
        fi
        echo "time=$(($(date +%s) - cmd_start))" >> "$metafile"
    ) &
}

# Collect results from completed background jobs into the associative arrays.
collect_results() {
    for key in "$@"; do
        local metafile="$TMPDIR_CHECKS/${key}.meta"
        local logfile="$TMPDIR_CHECKS/${key}.log"

        if [[ ! -f "$metafile" ]]; then
            continue
        fi

        local status
        status=$(grep "^status=" "$metafile" | head -1 | cut -d= -f2)
        RESULTS[$key]="$status"

        local time_val
        time_val=$(grep "^time=" "$metafile" | head -1 | cut -d= -f2)
        TIMES[$key]="$time_val"

        if grep -q "^errors<<ERREOF" "$metafile"; then
            local errs
            errs=$(sed -n '/^errors<<ERREOF$/,/^ERREOF$/{ /^errors<<ERREOF$/d; /^ERREOF$/d; p; }' "$metafile")
            ERRORS[$key]="$errs"
        fi

        if [[ "$VERBOSE" == true ]] && [[ -f "$logfile" ]]; then
            cat "$logfile"
        fi
    done
}

# Wait for a list of PIDs and then collect results for corresponding keys.
# Usage: wait_and_collect "key1:pid1" "key2:pid2" ...
wait_and_collect() {
    local keys=()
    for pair in "$@"; do
        local pid="${pair##*:}"
        keys+=("${pair%%:*}")
        wait "$pid" 2>/dev/null
    done
    collect_results "${keys[@]}"
}

echo -e "${BOLD}${BLUE}"
echo "+-----------------------------------------+"
echo "|     Steadfirm - Full Project Check      |"
echo "+-----------------------------------------+"
echo -e "${NC}"

# Clean build if requested
if [[ "$CLEAN_BUILD" == true ]]; then
    echo -e "${BOLD}${YELLOW}Cleaning all build artifacts...${NC}\n"

    echo -e "${BLUE}[Rust] Cleaning...${NC}"
    cd "$ROOT_DIR" && cargo clean 2>/dev/null
    echo -e "${GREEN}[Rust] Clean complete${NC}\n"

    echo -e "${BLUE}[Web] Cleaning...${NC}"
    rm -rf "$ROOT_DIR/web/node_modules" "$ROOT_DIR/web/dist"
    cd "$ROOT_DIR" && bun install
    echo -e "${GREEN}[Web] Clean complete${NC}\n"
fi

START_TIME=$(date +%s)

HAS_CARGO=false
if command -v cargo &> /dev/null; then
    HAS_CARGO=true
fi

# =============================================================================
# Step 1: Linting (all tasks in parallel)
# =============================================================================
vecho "${BOLD}Step 1/4: Linting${NC}"
LINT_START=$(date +%s)

LINT_PIDS=()

if [[ "$HAS_CARGO" == true ]]; then
    progress "1/4" "rust" "cargo fmt --check"
    run_bg "lint_rs_fmt" "cargo fmt --check" "$ROOT_DIR"
    LINT_PIDS+=("lint_rs_fmt:$!")

    progress "1/4" "rust" "cargo clippy"
    run_bg "lint_rs_clippy" "cargo clippy -- -D warnings" "$ROOT_DIR"
    LINT_PIDS+=("lint_rs_clippy:$!")
else
    RESULTS[lint_rs_fmt]="skipped"
    RESULTS[lint_rs_clippy]="skipped"
    vecho "${YELLOW}cargo not found, skipping Rust linting${NC}"
fi

if [[ -f "$ROOT_DIR/web/package.json" ]]; then
    progress "1/4" "web" "eslint"
    run_bg "lint_web" "bun run lint" "$ROOT_DIR/web"
    LINT_PIDS+=("lint_web:$!")
fi

wait_and_collect "${LINT_PIDS[@]}"
LINT_TIME=$(($(date +%s) - LINT_START))
vecho ""

# =============================================================================
# Step 2: Type Checking (all tasks in parallel)
# =============================================================================
vecho "${BOLD}Step 2/4: Type Checking${NC}"
TYPE_START=$(date +%s)

TYPE_PIDS=()

# Rust type checking is handled by cargo clippy / cargo build
RESULTS[type_rs]="n/a"

if [[ -f "$ROOT_DIR/web/tsconfig.json" ]]; then
    progress "2/4" "web" "tsc --noEmit"
    run_bg "type_web" "bun run typecheck" "$ROOT_DIR/web"
    TYPE_PIDS+=("type_web:$!")
fi

# Check TS packages for typecheck scripts
for pkg_dir in "$ROOT_DIR"/packages/*/; do
    pkg_name=$(basename "$pkg_dir")
    if [[ -f "$pkg_dir/package.json" ]] && grep -q '"typecheck"' "$pkg_dir/package.json" 2>/dev/null; then
        progress "2/4" "packages/$pkg_name" "tsc --noEmit"
        run_bg "type_pkg_${pkg_name}" "bun run typecheck" "$pkg_dir"
        TYPE_PIDS+=("type_pkg_${pkg_name}:$!")
    fi
done

if [[ ${#TYPE_PIDS[@]} -gt 0 ]]; then
    wait_and_collect "${TYPE_PIDS[@]}"
fi
TYPE_TIME=$(($(date +%s) - TYPE_START))
vecho ""

# =============================================================================
# Step 3: Testing (all suites in parallel)
# =============================================================================
vecho "${BOLD}Step 3/4: Testing${NC}"
TEST_START=$(date +%s)

TEST_PIDS=()

# Rust tests
if [[ "$HAS_CARGO" == true ]]; then
    progress "3/4" "rust" "cargo test"
    run_bg "test_rs" "cargo test" "$ROOT_DIR"
    TEST_PIDS+=("test_rs:$!")
else
    RESULTS[test_rs]="skipped"
fi

# Web tests (if test script exists)
if [[ -f "$ROOT_DIR/web/package.json" ]] && grep -q '"test"' "$ROOT_DIR/web/package.json" 2>/dev/null; then
    progress "3/4" "web" "bun run test"
    run_bg "test_web" "bun run test" "$ROOT_DIR/web"
    TEST_PIDS+=("test_web:$!")
else
    RESULTS[test_web]="skipped"
    vecho "${YELLOW}No test script in web/, skipping${NC}"
fi

# TS packages tests (if test script exists)
for pkg_dir in "$ROOT_DIR"/packages/*/; do
    pkg_name=$(basename "$pkg_dir")
    if [[ -f "$pkg_dir/package.json" ]] && grep -q '"test"' "$pkg_dir/package.json" 2>/dev/null; then
        progress "3/4" "packages/$pkg_name" "bun test"
        run_bg "test_pkg_${pkg_name}" "bun run test" "$pkg_dir"
        TEST_PIDS+=("test_pkg_${pkg_name}:$!")
    fi
done

if [[ ${#TEST_PIDS[@]} -gt 0 ]]; then
    wait_and_collect "${TEST_PIDS[@]}"
fi
TEST_TIME=$(($(date +%s) - TEST_START))
vecho ""

# =============================================================================
# Step 4: Building (all tasks in parallel)
# =============================================================================
vecho "${BOLD}Step 4/4: Building${NC}"
BUILD_START=$(date +%s)

BUILD_PIDS=()

if [[ "$HAS_CARGO" == true ]]; then
    progress "4/4" "rust" "cargo build"
    run_bg "build_rs" "cargo build" "$ROOT_DIR"
    BUILD_PIDS+=("build_rs:$!")
else
    RESULTS[build_rs]="skipped"
fi

if [[ -f "$ROOT_DIR/web/package.json" ]]; then
    progress "4/4" "web" "vite build"
    run_bg "build_web" "bun run build" "$ROOT_DIR/web"
    BUILD_PIDS+=("build_web:$!")
fi

wait_and_collect "${BUILD_PIDS[@]}"
BUILD_TIME=$(($(date +%s) - BUILD_START))
vecho ""

# =============================================================================
# Summary
# =============================================================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

status_icon() {
    case "$1" in
        passed) echo -e "${GREEN}✓${NC}" ;;
        failed) echo -e "${RED}✗${NC}" ;;
        skipped|n/a) echo -e "${DIM}-${NC}" ;;
    esac
}

step_status() {
    for status in "$@"; do
        if [[ "$status" == "failed" ]]; then
            echo "failed"
            return
        fi
    done
    echo "passed"
}

print_task() {
    local prefix="$1" name="$2" tool="$3" key="$4"
    local result="${RESULTS[$key]:-skipped}"
    local icon=$(status_icon "$result")
    local time_str=""
    if [[ -n "${TIMES[$key]:-}" ]]; then
        time_str="  ${DIM}${TIMES[$key]}s${NC}"
    fi

    if [[ "$result" == "n/a" || "$result" == "skipped" ]]; then
        echo -e "      ${DIM}${prefix}${NC} ${name}  ${DIM}${tool}${NC}"
    elif [[ "$result" == "failed" ]]; then
        echo -e "      ${DIM}${prefix}${NC} ${name}  ${CYAN}${tool}${NC}  ${icon}${time_str}"
        if [[ -n "${ERRORS[$key]:-}" ]]; then
            echo -e "${RED}${ERRORS[$key]}${NC}" | sed 's/^/           /'
        fi
    else
        echo -e "      ${DIM}${prefix}${NC} ${name}  ${CYAN}${tool}${NC}  ${icon}${time_str}"
    fi
}

echo -e "${BOLD}${BLUE}"
echo "+-----------------------------------------+"
echo "|                Summary                  |"
echo "+-----------------------------------------+"
echo -e "${NC}"

# Linting
LINT_STATUS=$(step_status "${RESULTS[lint_rs_fmt]:-skipped}" "${RESULTS[lint_rs_clippy]:-skipped}" "${RESULTS[lint_web]:-skipped}")
printf "  %s ${BOLD}%-14s${NC} ${DIM}%3ds${NC}\n" "$(status_icon $LINT_STATUS)" "Linting" "$LINT_TIME"
print_task "├─" "rust:   " "cargo fmt --check" "lint_rs_fmt"
print_task "├─" "rust:   " "cargo clippy" "lint_rs_clippy"
print_task "└─" "web:    " "eslint" "lint_web"
echo ""

# Type Checking
TYPE_STATUS=$(step_status "${RESULTS[type_rs]:-n/a}" "${RESULTS[type_web]:-skipped}")
printf "  %s ${BOLD}%-14s${NC} ${DIM}%3ds${NC}\n" "$(status_icon $TYPE_STATUS)" "Type Check" "$TYPE_TIME"
print_task "├─" "rust:   " "n/a (compile)" "type_rs"
print_task "└─" "web:    " "tsc --noEmit" "type_web"
echo ""

# Testing
TEST_STATUS=$(step_status "${RESULTS[test_rs]:-skipped}" "${RESULTS[test_web]:-skipped}")
printf "  %s ${BOLD}%-14s${NC} ${DIM}%3ds${NC}\n" "$(status_icon $TEST_STATUS)" "Tests" "$TEST_TIME"
print_task "├─" "rust:   " "cargo test" "test_rs"
print_task "└─" "web:    " "bun run test" "test_web"
echo ""

# Building
BUILD_STATUS=$(step_status "${RESULTS[build_rs]:-skipped}" "${RESULTS[build_web]:-skipped}")
printf "  %s ${BOLD}%-14s${NC} ${DIM}%3ds${NC}\n" "$(status_icon $BUILD_STATUS)" "Build" "$BUILD_TIME"
print_task "├─" "rust:   " "cargo build" "build_rs"
print_task "└─" "web:    " "vite build" "build_web"
echo ""

echo -e "  ${DIM}─────────────────────────────────────────${NC}"
printf "  ${BOLD}%-17s${NC}${BOLD}%4ds${NC}\n" "Total" "$DURATION"
echo ""

# Final status
FAILED_COUNT=0
[[ "$LINT_STATUS" == "failed" ]] && ((FAILED_COUNT++))
[[ "$TYPE_STATUS" == "failed" ]] && ((FAILED_COUNT++))
[[ "$TEST_STATUS" == "failed" ]] && ((FAILED_COUNT++))
[[ "$BUILD_STATUS" == "failed" ]] && ((FAILED_COUNT++))

if [[ $FAILED_COUNT -eq 0 ]]; then
    echo -e "  ${BOLD}${GREEN}All checks passed!${NC}"
    echo ""
    exit 0
else
    echo -e "  ${BOLD}${RED}${FAILED_COUNT} check(s) failed${NC}"
    echo ""
    exit 1
fi
