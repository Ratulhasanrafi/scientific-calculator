'use strict';

/* ============================================================
 * Scientific calculator engine (no dependencies, no eval).
 * Tokenizer -> shunting-yard -> RPN evaluator.
 * Works in browser and Node (for smoke tests).
 * ============================================================ */

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'log', 'ln', 'sqrt', 'cbrt', 'abs', 'recip',
]);
const CONSTANTS = { pi: Math.PI, e: Math.E };

function normalize(input) {
  return input
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/∛/g, 'cbrt')
    .replace(/\s+/g, '');
}

// Split into tokens: numbers, identifiers, operators, parens.
function tokenize(src) {
  const s = normalize(src);
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

  while (i < s.length) {
    const c = s[i];
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1] || ''))) {
      let num = '';
      let dots = 0;
      while (i < s.length && (isDigit(s[i]) || s[i] === '.')) {
        if (s[i] === '.') dots++;
        if (dots > 1) throw new Error('Invalid number');
        num += s[i++];
      }
      tokens.push({ type: 'num', value: parseFloat(num) });
    } else if (isLetter(c)) {
      let name = '';
      while (i < s.length && isLetter(s[i])) name += s[i++];
      name = name.toLowerCase();
      if (name === 'mod') tokens.push({ type: 'op', value: 'mod' });
      else if (name === 'ans') tokens.push({ type: 'ans' });
      else if (FUNCTIONS.has(name)) tokens.push({ type: 'func', value: name });
      else if (name in CONSTANTS) tokens.push({ type: 'num', value: CONSTANTS[name] });
      else throw new Error('Unknown name: ' + name);
    } else if (c === '(' || c === ')') {
      tokens.push({ type: 'paren', value: c });
      i++;
    } else if ('+-*/^!%'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
    } else {
      throw new Error("Unexpected character: '" + c + "'");
    }
  }
  return tokens;
}

// Insert explicit * where multiplication is implicit: 2pi, 2(3), (2)(3), 2sin(30)
function insertImplicitMult(tokens) {
  const out = [];
  const needsMult = (t) =>
    t.type === 'num' || t.type === 'ans' ||
    (t.type === 'paren' && t.value === ')') ||
    (t.type === 'op' && (t.value === '!' || t.value === '%'));
  const startsValue = (t) =>
    t.type === 'num' || t.type === 'ans' || t.type === 'func' ||
    (t.type === 'paren' && t.value === '(');
  for (let k = 0; k < tokens.length; k++) {
    out.push(tokens[k]);
    const nxt = tokens[k + 1];
    if (nxt && needsMult(tokens[k]) && startsValue(nxt)) {
      out.push({ type: 'op', value: '*' });
    }
  }
  return out;
}

const PREC = { '+': 2, '-': 2, '*': 3, '/': 3, mod: 3, 'u-': 4, '^': 5 };
const RIGHT_ASSOC = new Set(['^', 'u-']);

function toRPN(tokens) {
  const output = [];
  const stack = [];
  let prev = null;

  for (const t of tokens) {
    if (t.type === 'num' || t.type === 'ans') {
      output.push(t);
    } else if (t.type === 'func') {
      stack.push(t);
    } else if (t.type === 'op' && (t.value === '!' || t.value === '%')) {
      output.push(t); // postfix operators go straight to output
    } else if (t.type === 'op') {
      let op = t.value;
      // Detect unary minus: at start, or after another operator / '(' / function.
      if (op === '-' && (
        prev === null ||
        (prev.type === 'op' && prev.value !== '!' && prev.value !== '%') ||
        (prev.type === 'paren' && prev.value === '(') ||
        prev.type === 'func'
      )) {
        op = 'u-';
        stack.push({ type: 'op', value: 'u-' }); // binds to next primary
      } else if (op === '+' && (
        prev === null ||
        (prev.type === 'op' && prev.value !== '!' && prev.value !== '%') ||
        (prev.type === 'paren' && prev.value === '(') ||
        prev.type === 'func'
      )) {
        // unary plus: no-op, skip
      } else {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type !== 'op') break;
          const pTop = PREC[top.value];
          const pCur = PREC[op];
          if (pTop > pCur || (pTop === pCur && !RIGHT_ASSOC.has(op))) {
            output.push(stack.pop());
          } else break;
        }
        stack.push({ type: 'op', value: op });
      }
    } else if (t.type === 'paren' && t.value === '(') {
      stack.push(t);
    } else if (t.type === 'paren' && t.value === ')') {
      let found = false;
      while (stack.length) {
        const top = stack.pop();
        if (top.type === 'paren' && top.value === '(') { found = true; break; }
        output.push(top);
      }
      if (!found) throw new Error('Mismatched parentheses');
      if (stack.length && stack[stack.length - 1].type === 'func') {
        output.push(stack.pop());
      }
    }
    prev = t;
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.type === 'paren') throw new Error('Mismatched parentheses');
    output.push(top);
  }
  return rpnValidate(output);
}

function rpnValidate(rpn) {
  // Catch trailing binary operators etc. early with a depth check.
  let depth = 0;
  for (const t of rpn) {
    if (t.type === 'num' || t.type === 'ans') depth++;
    else if (t.type === 'func' || (t.type === 'op' && (t.value === 'u-' || t.value === '!' || t.value === '%'))) {
      if (depth < 1) throw new Error('Invalid syntax');
    } else {
      if (depth < 2) throw new Error('Invalid syntax');
      depth--;
    }
  }
  if (depth !== 1) throw new Error('Invalid syntax');
  return rpn;
}

function fact(n) {
  if (n < 0 || !Number.isInteger(n)) throw new Error('Factorial needs a non-negative integer');
  if (n > 170) throw new Error('Factorial overflow');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function evalRPN(rpn, mode, ansValue) {
  const st = [];
  const toRad = (x) => (mode === 'DEG' ? (x * Math.PI) / 180 : x);
  const fromRad = (x) => (mode === 'DEG' ? (x * 180) / Math.PI : x);

  for (const t of rpn) {
    if (t.type === 'num') st.push(t.value);
    else if (t.type === 'ans') {
      if (ansValue === null || ansValue === undefined) throw new Error('Ans is empty');
      st.push(ansValue);
    }
    else if (t.type === 'op' && t.value === 'u-') st.push(-st.pop());
    else if (t.type === 'op' && t.value === '!') st.push(fact(st.pop()));
    else if (t.type === 'op' && t.value === '%') st.push(st.pop() / 100);
    else if (t.type === 'op') {
      const b = st.pop(), a = st.pop();
      let r;
      switch (t.value) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/':
          if (b === 0) throw new Error('Division by zero');
          r = a / b; break;
        case 'mod':
          if (b === 0) throw new Error('Division by zero');
          r = a % b; break;
        case '^': r = Math.pow(a, b); break;
        default: throw new Error('Unknown operator');
      }
      if (Number.isNaN(r)) throw new Error('Math error (undefined result)');
      if (!Number.isFinite(r)) throw new Error('Math error (overflow)');
      st.push(r);
    }
    else if (t.type === 'func') {
      const x = st.pop();
      let r;
      switch (t.value) {
        case 'sin': r = Math.sin(toRad(x)); break;
        case 'cos': r = Math.cos(toRad(x)); break;
        case 'tan':
          if (mode === 'DEG' && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-9) {
            throw new Error('tan undefined at 90° + k·180°');
          }
          r = Math.tan(toRad(x)); break;
        case 'asin':
          if (Math.abs(x) > 1) throw new Error('asin domain is [-1, 1]');
          r = fromRad(Math.asin(x)); break;
        case 'acos':
          if (Math.abs(x) > 1) throw new Error('acos domain is [-1, 1]');
          r = fromRad(Math.acos(x)); break;
        case 'atan': r = fromRad(Math.atan(x)); break;
        case 'log':
          if (x <= 0) throw new Error('log domain is x > 0');
          r = Math.log10(x); break;
        case 'ln':
          if (x <= 0) throw new Error('ln domain is x > 0');
          r = Math.log(x); break;
        case 'sqrt':
          if (x < 0) throw new Error('sqrt of negative number');
          r = Math.sqrt(x); break;
        case 'cbrt': r = Math.cbrt(x); break;
        case 'abs': r = Math.abs(x); break;
        case 'recip':
          if (x === 0) throw new Error('Division by zero');
          r = 1 / x; break;
        default: throw new Error('Unknown function');
      }
      if (Number.isNaN(r)) throw new Error('Math error (undefined result)');
      st.push(r);
    }
  }
  if (st.length !== 1) throw new Error('Invalid syntax');
  return st[0];
}

function formatResult(r) {
  if (!Number.isFinite(r)) throw new Error('Math error (overflow)');
  if (Object.is(r, -0)) r = 0;
  // Snap trig-style floating noise to clean integers when extremely close.
  const rounded = Math.round(r);
  if (Math.abs(r - rounded) < 1e-12) r = rounded;
  if (Number.isInteger(r) && Math.abs(r) < 1e15) return String(r);
  let s = String(parseFloat(r.toPrecision(12)));
  return s;
}

function evaluate(expr, mode, ansValue) {
  if (!expr || !expr.trim()) throw new Error('Empty expression');
  const tokens = insertImplicitMult(tokenize(expr));
  if (!tokens.length) throw new Error('Empty expression');
  const rpn = toRPN(tokens);
  return evalRPN(rpn, mode === 'RAD' ? 'RAD' : 'DEG', ansValue);
}

// Pretty-print ASCII expression for the display line.
function pretty(expr) {
  return expr
    .replace(/\*/g, '×')
    .replace(/\//g, '÷')
    .replace(/-/g, '−')
    .replace(/pi/g, 'π')
    .replace(/sqrt/g, '√')
    .replace(/cbrt/g, '∛')
    .replace(/recip/g, '1/');
}

/* ============================================================
 * Browser UI wiring (skipped under Node).
 * ============================================================ */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const exprInput = document.getElementById('expr');
    const resultEl = document.getElementById('result');
    const modeBtn = document.getElementById('modeBtn');
    const invBtn = document.getElementById('invBtn');
    const memEl = document.getElementById('memIndicator');
    const histEl = document.getElementById('history');
    const themeBtn = document.getElementById('themeBtn');

    let mode = 'DEG';
    let inv = false;
    let memory = 0;
    let memSet = false;
    let ans = null;
    let justEvaluated = false;

    const INV_SWAP = [
      ['sin(', 'asin('], ['cos(', 'acos('], ['tan(', 'atan('],
      ['ln(', 'e^('], ['log(', '10^('],
    ];

    function setResult(text, isError) {
      resultEl.textContent = text;
      resultEl.classList.toggle('error', !!isError);
    }

    function insertText(text) {
      if (justEvaluated && /^[0-9.(]/.test(text[0])) {
        exprInput.value = '';
      }
      justEvaluated = false;
      const { selectionStart: s, selectionEnd: e, value: v } = exprInput;
      exprInput.value = v.slice(0, s) + text + v.slice(e);
      const pos = s + text.length;
      exprInput.setSelectionRange(pos, pos);
      exprInput.focus();
    }

    function doEquals() {
      const raw = exprInput.value;
      try {
        const val = evaluate(raw, mode, ans);
        ans = val;
        setResult('= ' + formatResult(val), false);
        addHistory(raw, formatResult(val));
      } catch (err) {
        setResult('Error: ' + err.message, true);
      }
      justEvaluated = true;
    }

    function addHistory(raw, formatted) {
      const item = document.createElement('button');
      item.className = 'hist-item';
      item.type = 'button';
      item.textContent = pretty(raw) + ' = ' + formatted;
      item.title = 'Click to reuse';
      item.addEventListener('click', () => {
        exprInput.value = raw;
        justEvaluated = false;
        exprInput.focus();
      });
      histEl.prepend(item);
    }

    function togglePM() {
      const { selectionStart: pos, value: v } = exprInput;
      let i = pos;
      while (i > 0 && /[0-9.]/.test(v[i - 1])) i--;
      if (i < pos) {
        if (i > 0 && v[i - 1] === '-' && (i < 2 || /[(+\-*/^]/.test(v[i - 2]))) {
          exprInput.value = v.slice(0, i - 1) + v.slice(i);
          exprInput.setSelectionRange(pos - 1, pos - 1);
        } else {
          exprInput.value = v.slice(0, i) + '-' + v.slice(i);
          exprInput.setSelectionRange(pos + 1, pos + 1);
        }
      } else {
        insertText('-');
      }
      exprInput.focus();
    }

    const INV_LABEL = { 'asin(': 'sin⁻¹(', 'acos(': 'cos⁻¹(', 'atan(': 'tan⁻¹(', 'e^(': 'eˣ', '10^(': '10ˣ' };

    document.querySelectorAll('#keys button, #copyBtn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ins = btn.dataset.insert;
        const act = btn.dataset.action;
        if (ins !== undefined) { insertText(ins); return; }
        switch (act) {
          case 'equals': doEquals(); break;
          case 'clear': exprInput.value = ''; setResult('0', false); justEvaluated = false; break;
          case 'ce': exprInput.value = exprInput.value.slice(0, exprInput.selectionStart) || ''; break;
          case 'back': {
            const { selectionStart: s, selectionEnd: e, value: v } = exprInput;
            if (s !== e) exprInput.value = v.slice(0, s) + v.slice(e);
            else exprInput.value = v.slice(0, Math.max(0, s - 1)) + v.slice(s);
            justEvaluated = false;
            break;
          }
          case 'pm': togglePM(); break;
          case 'mode':
            mode = mode === 'DEG' ? 'RAD' : 'DEG';
            modeBtn.textContent = mode;
            break;
          case 'inv': {
            inv = !inv;
            invBtn.classList.toggle('active', inv);
            document.querySelectorAll('#keys button[data-inv]').forEach((b) => {
              const pair = INV_SWAP.find(([a, c]) => a === b.dataset.insert || c === b.dataset.insert);
              if (!pair) return;
              const target = inv ? pair[1] : pair[0];
              b.dataset.insert = target;
              b.querySelector('.lbl').textContent = inv ? (INV_LABEL[target] || target) : pretty(pair[0]);
            });
            break;
          }
          case 'mplus': memory = (memSet ? memory : 0) + (ans ?? 0); memSet = true; memEl.hidden = false; break;
          case 'mminus': memory = (memSet ? memory : 0) - (ans ?? 0); memSet = true; memEl.hidden = false; break;
          case 'mr': if (memSet) insertText(String(memory)); break;
          case 'mc': memory = 0; memSet = false; memEl.hidden = true; break;
          case 'copy': {
            const t = resultEl.textContent.replace(/^= /, '');
            if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
            break;
          }
          case 'ans': insertText('Ans'); break;
        }
        exprInput.focus();
      });
    });

    document.getElementById('clearHist').addEventListener('click', () => { histEl.innerHTML = ''; });
    themeBtn.addEventListener('click', () => {
      const dark = document.body.classList.toggle('light');
      themeBtn.textContent = dark ? '☀️' : '🌙';
    });

    exprInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); doEquals(); }
      else if (ev.key === 'Escape') { exprInput.value = ''; setResult('0', false); }
    });

    setResult('0', false);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluate, formatResult, tokenize, toRPN, pretty };
}
