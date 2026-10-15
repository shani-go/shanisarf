// Local ESLint rule enforcing the port's Python-string-semantics invariant:
// under src/engine/, the port must never rely on JavaScript's own
// whitespace/digit definitions, because they differ from Python's and would
// silently break parity. It reports:
//
//   - calls to String.prototype.trim / trimStart / trimEnd
//     (use pyStrip from python-compat.ts instead)
//   - the \s and \d escapes inside a regular expression — both literal /.../
//     regexes and the RegExp(...) constructor with a string pattern
//     (translate CAMeL Tools' class literally, or use PY_WHITESPACE)
//
// This is report-only tooling; it edits nothing.

const TRIM_METHODS = new Set(['trim', 'trimStart', 'trimEnd']);

/** Does a regex source string use \s or \d (an unescaped backslash + s/d)? */
function usesWhitespaceOrDigitClass(source) {
  // Walk the source, tracking backslash escapes, so that "\\s" (an escaped
  // backslash followed by a literal s) does not count but "\s" does.
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\\') continue;
    const next = source[i + 1];
    if (next === 's' || next === 'S' || next === 'd' || next === 'D') {
      return next.toLowerCase();
    }
    // Skip the escaped character so a literal "\\" is not misread.
    i++;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid JavaScript string semantics (trim family, \\s/\\d in regex) under src/engine/.',
    },
    schema: [],
    messages: {
      trim: "Do not use String.prototype.{{name}} under src/engine/; use pyStrip from python-compat.ts.",
      regexClass:
        "Do not use \\{{cls}} in a regular expression under src/engine/; translate CAMeL Tools' class literally or use PY_WHITESPACE.",
    },
  },

  create(context) {
    // RegExp(pattern) / new RegExp(pattern): the string VALUE of a literal
    // first argument is the regex source, so "\\s" in source becomes the
    // regex \s. Scan the computed value, not the raw text.
    function checkRegExpCall(node) {
      const callee = node.callee;
      if (callee.type !== 'Identifier' || callee.name !== 'RegExp') return;
      const first = node.arguments[0];
      if (first && first.type === 'Literal' && typeof first.value === 'string') {
        const cls = usesWhitespaceOrDigitClass(first.value);
        if (cls) {
          context.report({ node: first, messageId: 'regexClass', data: { cls } });
        }
      }
    }

    return {
      // s.trim(), s.trimStart(), s.trimEnd()
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          TRIM_METHODS.has(callee.property.name)
        ) {
          context.report({
            node: callee.property,
            messageId: 'trim',
            data: { name: callee.property.name },
          });
        }

        checkRegExpCall(node);
      },

      NewExpression(node) {
        checkRegExpCall(node);
      },

      // /.../ regex literals
      Literal(node) {
        if (node.regex) {
          const cls = usesWhitespaceOrDigitClass(node.regex.pattern);
          if (cls) {
            context.report({ node, messageId: 'regexClass', data: { cls } });
          }
        }
      },
    };
  },
};
