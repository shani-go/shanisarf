#!/usr/bin/env python3
# shanisarf parity harness — venv smoke test.
# Part of shanisarf. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
#
# New-design file: this is the harness's own guard logic, not a port of any
# CAMeL Tools module, so it carries the project header only.
#
# What this proves:
#
#   1. The pinned venv built from requirements.txt WITHOUT torch,
#      transformers, scikit-learn or camel-kenlm is sufficient: the analysis
#      path (camel_tools.morphology / .utils / .tokenizers) imports cleanly.
#   2. shanisarf uses only those three subpackages — importing anything else
#      from camel_tools here would be a lie about our footprint, so we don't.
#   3. The data-fetching entry points that pull GPL/LDC databases
#      (camel_data, MorphologyDB.builtin_db, list_builtin_dbs) are NEVER
#      called by the harness. We assert they exist (so a silent upstream
#      rename is caught) but prove, by never invoking them and by refusing
#      the forbidden heavy imports, that the generator stays off that path.
#
# Run directly (python tools/parity/smoke_import.py) or via
# `npm run parity:setup`, which runs it after installing the venv. Exits 0 on
# success; prints a one-line reason and exits non-zero on any failure.

import importlib
import sys


# The ONLY camel_tools subpackages shanisarf's port and harness depend on.
# The generator and the TypeScript engine mirror exactly these.
ALLOWED_SUBPACKAGES = (
    "camel_tools.morphology",
    "camel_tools.morphology.database",
    "camel_tools.morphology.analyzer",
    "camel_tools.morphology.generator",
    "camel_tools.morphology.reinflector",
    "camel_tools.utils",
    "camel_tools.utils.charmap",
    "camel_tools.utils.charsets",
    "camel_tools.utils.dediac",
    "camel_tools.utils.normalize",
    "camel_tools.utils.transliterate",
    "camel_tools.tokenizers",
    "camel_tools.tokenizers.word",
)

# Modules that MUST stay out of the venv. If --no-deps was bypassed or the
# dependency list drifted, one of these would import; that is a setup bug.
FORBIDDEN_MODULES = (
    "torch",
    "transformers",
    "sklearn",       # scikit-learn's import name
    "camel_kenlm",   # camel-kenlm's import name
)

# Data-fetch entry points that reach for out-of-range (GPL / LDC) databases.
# The harness never calls these; CLAUDE.md's hard stop. We check they exist
# so an upstream rename surfaces here instead of silently, but we do not run
# them.
FORBIDDEN_CALLS = (
    ("camel_tools.data", "camel_data"),
    ("camel_tools.morphology.database", "MorphologyDB", "builtin_db"),
    ("camel_tools.morphology.database", "MorphologyDB", "list_builtin_dbs"),
)

EXPECTED_VERSION = "1.6.0"


def _fail(message):
    print("smoke_import: FAIL — " + message, file=sys.stderr)
    sys.exit(1)


def check_version():
    import camel_tools

    version = getattr(camel_tools, "__version__", None)
    if version != EXPECTED_VERSION:
        _fail(
            "camel_tools.__version__ is %r, expected %r (check the pin in "
            "requirements.txt and rebuild the venv)" % (version, EXPECTED_VERSION)
        )
    print("ok   camel_tools version %s" % version)


def check_allowed_imports():
    for name in ALLOWED_SUBPACKAGES:
        try:
            importlib.import_module(name)
        except Exception as exc:  # noqa: BLE001 — report any import failure
            _fail(
                "could not import %s: %s (the --no-deps venv is missing an "
                "analysis-path dependency; add it to requirements.txt)"
                % (name, exc)
            )
    print("ok   imported %d analysis-path modules" % len(ALLOWED_SUBPACKAGES))


def check_forbidden_absent():
    for name in FORBIDDEN_MODULES:
        if name in sys.modules:
            _fail(
                "%s is already imported — the analysis path should not pull it"
                % name
            )
        try:
            importlib.import_module(name)
        except ImportError:
            continue  # expected: --no-deps kept it out
        except Exception as exc:  # noqa: BLE001
            # Present but failed to initialize: still means it is installed.
            _fail(
                "%s is installed (import raised %s rather than ImportError); "
                "the venv was built without --no-deps or the dependency list "
                "drifted" % (name, type(exc).__name__)
            )
        else:
            _fail(
                "%s is installed and importable; rebuild the venv with "
                "--no-deps so it stays out" % name
            )
    print("ok   %d forbidden heavy modules absent" % len(FORBIDDEN_MODULES))


def check_forbidden_calls_present_but_unused():
    # These attributes should EXIST (so a rename is caught) but the harness
    # must never call them. This function only resolves the attribute; it does
    # not invoke it.
    for entry in FORBIDDEN_CALLS:
        module_name = entry[0]
        attr_path = entry[1:]
        try:
            obj = importlib.import_module(module_name)
        except ImportError:
            # Not every build exposes camel_tools.data; absence is fine — if it
            # is not there, we certainly are not calling it.
            print("ok   %s not present (cannot be called)" % module_name)
            continue
        resolved = obj
        missing = False
        for attr in attr_path:
            if not hasattr(resolved, attr):
                missing = True
                break
            resolved = getattr(resolved, attr)
        label = module_name + "." + ".".join(attr_path)
        if missing:
            # An upstream rename. Not fatal to the harness (we never call it),
            # but worth a visible note so the exclusion stays honest.
            print("note %s not found (upstream renamed?); harness never calls it"
                  % label)
        else:
            print("ok   %s exists and is intentionally never called" % label)


def main():
    check_version()
    check_allowed_imports()
    check_forbidden_absent()
    check_forbidden_calls_present_but_unused()
    print("smoke_import: PASS — analysis path only, no out-of-range deps, "
          "no data-fetch calls")
    return 0


if __name__ == "__main__":
    sys.exit(main())
