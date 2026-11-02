const input = document.querySelector('#programInput');
const lineNumbers = document.querySelector('#lineNumbers');
const syntaxStatus = document.querySelector('#syntaxStatus');
const treeGrid = document.querySelector('#treeGrid');
const resolvedTree = document.querySelector('#resolvedTree');
const presetList = document.querySelector('#presetList');
const toast = document.querySelector('#toast');

const presets = [
  {
    title: 'Classic dangling else', tag: '2 parses',
    code: `if (loggedIn)\n  if (isAdmin)\n    showDashboard();\n  else\n    showRequestAccess();`
  },
  {
    title: 'Three levels deep', tag: '3 parses',
    code: `if (hasAccount)\n  if (emailVerified)\n    if (isPremium)\n      unlockReports();\n    else\n      showUpgrade();`
  },
  {
    title: 'Explicitly matched', tag: '1 parse',
    code: `if (isMember)\n  if (hasTicket)\n    enterVenue();\n  else\n    buyTicket();\nelse\n  signIn();`
  },
  {
    title: 'Two competing elses', tag: '3 parses',
    code: `if (A)\n  if (B)\n    if (C)\n      runTask();\n    else\n      recoverC();\n  else\n    recoverB();`
  },
  {
    title: 'No else yet', tag: '1 parse',
    code: `if (hasPermission)\n  if (isOwner)\n    editDocument();`
  }
];

let lastAnalysis = null;
let toastTimer = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function actionLabel(value) {
  const clean = value.trim().replace(/;\s*$/, '');
  return clean.length > 18 ? `${clean.slice(0, 17)}…` : clean || 'action';
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  const isBoundary = (index) => !/[A-Za-z0-9_$]/.test(source[index] || '');
  const wordAt = (word, index) => source.slice(index, index + word.length) === word && isBoundary(index - 1) && isBoundary(index + word.length);
  const skipSpace = () => { while (/\s/.test(source[i] || '')) i += 1; };

  while (i < source.length) {
    skipSpace();
    if (i >= source.length) break;
    if (wordAt('if', i)) {
      tokens.push({ type: 'IF' });
      i += 2; skipSpace();
      if (source[i] !== '(') throw new Error('Expected a condition in parentheses after “if”.');
      const start = ++i;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === '(') depth += 1;
        if (source[i] === ')') depth -= 1;
        i += 1;
      }
      if (depth !== 0) throw new Error('A condition is missing its closing parenthesis.');
      const condition = source.slice(start, i - 1).trim();
      if (!condition) throw new Error('Conditions cannot be empty.');
      tokens.push({ type: 'COND', value: condition });
      continue;
    }
    if (wordAt('else', i)) {
      tokens.push({ type: 'ELSE' });
      i += 4;
      continue;
    }

    const start = i;
    let parentheses = 0;
    while (i < source.length) {
      if (source[i] === '(') parentheses += 1;
      if (source[i] === ')') parentheses -= 1;
      if (source[i] === ';' && parentheses === 0) { i += 1; break; }
      if (parentheses === 0 && i > start && (wordAt('if', i) || wordAt('else', i))) break;
      i += 1;
    }
    const action = source.slice(start, i).trim();
    if (!action) { i += 1; continue; }
    tokens.push({ type: 'ACTION', value: action });
  }
  return tokens;
}

function parseAll(tokens) {
  const memo = new Map();
  const key = pos => `${pos}`;
  function parseAt(pos) {
    if (memo.has(key(pos))) return memo.get(key(pos));
    const token = tokens[pos];
    const results = [];
    if (!token) return results;
    if (token.type === 'ACTION') results.push({ node: { type: 'action', value: token.value }, end: pos + 1 });
    if (token.type === 'IF') {
      const condition = tokens[pos + 1];
      if (!condition || condition.type !== 'COND') throw new Error('Every “if” needs a condition in parentheses.');
      const thenResults = parseAt(pos + 2);
      if (!thenResults.length) throw new Error(`The condition “${condition.value}” needs a statement after it.`);
      thenResults.forEach(thenResult => {
        results.push({ node: { type: 'if', condition: condition.value, then: thenResult.node, otherwise: null }, end: thenResult.end });
        if (tokens[thenResult.end]?.type === 'ELSE') {
          const elseResults = parseAt(thenResult.end + 1);
          if (!elseResults.length) throw new Error('“else” needs a statement after it.');
          elseResults.forEach(elseResult => results.push({
            node: { type: 'if', condition: condition.value, then: thenResult.node, otherwise: elseResult.node }, end: elseResult.end
          }));
        }
      });
    }
    const unique = [];
    const seen = new Set();
    results.forEach(result => {
      const id = `${result.end}:${JSON.stringify(result.node)}`;
      if (!seen.has(id)) { seen.add(id); unique.push(result); }
    });
    memo.set(key(pos), unique.slice(0, 48));
    return memo.get(key(pos));
  }
  const parses = parseAt(0).filter(result => result.end === tokens.length).map(result => result.node);
  if (!parses.length) throw new Error('The program could not be read as a complete nested conditional. Make sure every action ends with “;”.');
  return parses;
}

function parseNearest(tokens) {
  function parseAt(pos) {
    const token = tokens[pos];
    if (!token) throw new Error('Expected a statement.');
    if (token.type === 'ACTION') return { node: { type: 'action', value: token.value }, end: pos + 1 };
    if (token.type !== 'IF' || tokens[pos + 1]?.type !== 'COND') throw new Error('Expected “if” or an action statement.');
    const condition = tokens[pos + 1].value;
    const thenResult = parseAt(pos + 2);
    let end = thenResult.end;
    let otherwise = null;
    if (tokens[end]?.type === 'ELSE') {
      const elseResult = parseAt(end + 1);
      otherwise = elseResult.node;
      end = elseResult.end;
    }
    return { node: { type: 'if', condition, then: thenResult.node, otherwise }, end };
  }
  const parsed = parseAt(0);
  if (parsed.end !== tokens.length) throw new Error('There is extra code after the final statement.');
  return parsed.node;
}

function countNodes(node, result = { ifs: 0, elses: 0, actions: 0 }) {
  if (node.type === 'action') { result.actions += 1; return result; }
  result.ifs += 1;
  if (node.otherwise) result.elses += 1;
  countNodes(node.then, result);
  if (node.otherwise) countNodes(node.otherwise, result);
  return result;
}

function collectBindings(node, bindings = [], depth = 0) {
  if (node.type === 'action') return bindings;
  if (node.otherwise) bindings.push({ condition: node.condition, depth });
  collectBindings(node.then, bindings, depth + 1);
  if (node.otherwise) collectBindings(node.otherwise, bindings, depth + 1);
  return bindings;
}

function treeMarkup(node) {
  if (node.type === 'action') return `<div class="tree-node action">${escapeHtml(actionLabel(node.value))}</div>`;
  const thenMarkup = treeMarkup(node.then);
  const elseMarkup = node.otherwise ? treeMarkup(node.otherwise) : '<div class="tree-node empty">open</div>';
  return `<div class="tree-root"><div class="tree-node"><b>if</b> (${escapeHtml(node.condition)})</div><div class="branches"><div class="branch"><span class="branch-label">THEN</span>${thenMarkup}</div><div class="branch"><span class="branch-label else-label">ELSE</span>${elseMarkup}</div></div></div>`;
}

function bindingText(node) {
  const bindings = collectBindings(node);
  if (!bindings.length) return 'No <code>else</code> clause';
  if (bindings.length === 1) return `<code>else</code> → <code>if (${escapeHtml(bindings[0].condition)})</code>`;
  return `${bindings.length} <code>else</code> clauses attached`;
}

function renderTrees(parses) {
  const nearestSignature = lastAnalysis ? JSON.stringify(lastAnalysis.nearest) : '';
  const nearestIndex = parses.findIndex(parse => JSON.stringify(parse) === nearestSignature);
  const first = nearestIndex >= 0 ? parses[nearestIndex] : parses[0];
  const second = parses.find(parse => JSON.stringify(parse) !== JSON.stringify(first)) || first;
  const ambiguous = parses.length > 1;
  treeGrid.innerHTML = `
    <article class="tree-card">
      <div class="tree-head"><span class="tree-flag">${ambiguous ? 'PATH A' : 'ONLY PATH'}</span><strong>${ambiguous ? 'Nearest attachment' : 'Grammar interpretation'}</strong><span>${bindingText(first)}</span></div>
      <div class="tree-visual">${treeMarkup(first)}</div>
      <p class="tree-note">${ambiguous ? 'The <code>else</code> completes the innermost still-open conditional.' : 'No second derivation is possible for this input.'}</p>
    </article>
    <article class="tree-card">
      <div class="tree-head"><span class="tree-flag">${ambiguous ? 'PATH B' : 'RESOLVED'}</span><strong>${ambiguous ? 'Alternate attachment' : 'Nearest-if rule'}</strong><span>${bindingText(second)}</span></div>
      <div class="tree-visual">${treeMarkup(second)}</div>
      <p class="tree-note">${ambiguous ? 'The same <code>else</code> is allowed to complete a different open conditional.' : 'Matched/unmatched rewriting preserves this single reading.'}</p>
    </article>`;
}

function formatProgram(source) {
  const tokens = tokenize(source);
  let indent = 0;
  let text = '';
  tokens.forEach((token, index) => {
    if (token.type === 'IF') {
      const condition = tokens[index + 1]?.value || '';
      text += `${'  '.repeat(indent)}if (${condition})\n`;
      indent += 1;
    } else if (token.type === 'COND') {
      // Condition was rendered along with its IF token.
    } else if (token.type === 'ELSE') {
      indent = Math.max(0, indent - 1);
      text += `${'  '.repeat(indent)}else\n`;
      indent += 1;
    } else if (token.type === 'ACTION') {
      text += `${'  '.repeat(indent)}${token.value.trim().replace(/;?$/, ';')}\n`;
    }
  });
  return text.trim();
}

function renderResolution(nearest, stats) {
  resolvedTree.innerHTML = treeMarkup(nearest);
  const bindings = collectBindings(nearest);
  const deepest = bindings.sort((a, b) => b.depth - a.depth)[0];
  const explanation = deepest
    ? `The inner <code>if (${escapeHtml(deepest.condition)})</code> is still unmatched when its <code>else</code> appears, so it receives that clause first.`
    : 'No <code>else</code> clause is waiting to be matched, so this program already has one reading.';
  document.querySelector('#explanationText').innerHTML = explanation;
  const checks = [
    `Read ${stats.ifs} <code>if</code> statement${stats.ifs === 1 ? '' : 's'} from the inside out.`,
    bindings.length ? `Attach ${bindings.length} <code>else</code> clause${bindings.length === 1 ? '' : 's'} to the nearest open <code>if</code>.` : 'No <code>else</code> attachment is needed.',
    'The transformed grammar leaves exactly one valid tree.'
  ];
  document.querySelector('#resolutionList').innerHTML = checks.map(item => `<div><span>✓</span><span>${item}</span></div>`).join('');
}

function updateLineNumbers() {
  const lines = Math.max(1, input.value.split('\n').length);
  lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function analyze(source = input.value, shouldScroll = false) {
  try {
    const tokens = tokenize(source);
    const parses = parseAll(tokens);
    const nearest = parseNearest(tokens);
    const stats = countNodes(nearest);
    lastAnalysis = { tokens, parses, nearest, stats };
    syntaxStatus.className = 'syntax-status';
    syntaxStatus.innerHTML = '<span></span> Syntax understood · ready to compare';
    const ambiguous = parses.length > 1;
    document.querySelector('#resultStrip').classList.toggle('resolved', !ambiguous);
    document.querySelector('#resultTitle').textContent = ambiguous ? 'Ambiguity detected' : 'One interpretation found';
    document.querySelector('#resultText').textContent = ambiguous
      ? `This program produces ${parses.length} valid parse trees before the grammar is rewritten.`
      : 'The current conditional structure has only one valid parse tree.';
    document.querySelector('#resultStrip .result-icon').textContent = ambiguous ? '!' : '✓';
    document.querySelector('#parseCount').textContent = parses.length;
    document.querySelector('#statIfs').textContent = stats.ifs;
    document.querySelector('#statElses').textContent = stats.elses;
    document.querySelector('#statParses').textContent = parses.length;
    renderTrees(parses);
    renderResolution(nearest, stats);
    if (shouldScroll) document.querySelector('#resultStrip').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  } catch (error) {
    syntaxStatus.className = 'syntax-status error';
    syntaxStatus.innerHTML = `<span></span> ${escapeHtml(error.message)}`;
    document.querySelector('#resultTitle').textContent = 'Input needs a small fix';
    document.querySelector('#resultText').textContent = error.message;
    document.querySelector('#parseCount').textContent = '—';
    document.querySelector('#resultStrip').classList.remove('resolved');
    document.querySelector('#resultStrip .result-icon').textContent = '×';
    treeGrid.innerHTML = '';
    resolvedTree.innerHTML = '';
    return false;
  }
}

function renderPresets() {
  presetList.innerHTML = presets.map((preset, index) => `<button class="preset ${index === 0 ? 'active' : ''}" type="button" data-index="${index}">
    <div class="preset-top"><strong>${preset.title}</strong><span class="preset-tag">${preset.tag}</span></div><p>${escapeHtml(preset.code.replace(/\n/g, ' '))}</p>
  </button>`).join('');
  presetList.addEventListener('click', event => {
    const button = event.target.closest('.preset');
    if (!button) return;
    const index = Number(button.dataset.index);
    input.value = presets[index].code;
    updateLineNumbers();
    analyze();
    document.querySelectorAll('.preset').forEach(item => item.classList.toggle('active', item === button));
    document.querySelector('#analyzer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Loaded: ${presets[index].title}`);
  });
}

function buildCase(depth, placement) {
  const labels = ['isReady', 'hasAccess', 'isVerified', 'isPriority', 'isFinal'];
  let result = '';
  for (let i = 0; i < depth; i += 1) result += `${'  '.repeat(i)}if (${labels[i]})\n`;
  result += `${'  '.repeat(depth)}completeTask();\n`;
  let elseCount = placement === 'one' ? 1 : placement === 'all-but-one' ? depth - 1 : depth;
  for (let i = 0; i < elseCount; i += 1) {
    const level = depth - i - 1;
    result += `${'  '.repeat(level)}else\n${'  '.repeat(level + 1)}fallback${level + 1}();\n`;
  }
  return result.trim();
}

document.querySelector('#analyzeButton').addEventListener('click', () => {
  if (analyze(input.value, true)) showToast('Parse trees updated');
});
input.addEventListener('input', () => { updateLineNumbers(); analyze(); });
document.querySelector('#formatButton').addEventListener('click', () => {
  try { input.value = formatProgram(input.value); updateLineNumbers(); analyze(); showToast('Nested conditional formatted'); }
  catch (error) { syntaxStatus.className = 'syntax-status error'; syntaxStatus.innerHTML = `<span></span> ${escapeHtml(error.message)}`; }
});
document.querySelector('#depthRange').addEventListener('input', event => { document.querySelector('#depthOutput').value = event.target.value; });
document.querySelector('#generateButton').addEventListener('click', () => {
  const depth = Number(document.querySelector('#depthRange').value);
  const placement = document.querySelector('#elseSelect').value;
  input.value = buildCase(depth, placement);
  updateLineNumbers(); analyze(input.value, true);
  document.querySelectorAll('.preset').forEach(item => item.classList.remove('active'));
  showToast(`Generated ${depth}-level test case`);
});
document.querySelector('#showDerivation').addEventListener('click', () => document.querySelector('#resolution').scrollIntoView({ behavior: 'smooth', block: 'start' }));
document.querySelector('#themeButton').addEventListener('click', () => {
  document.body.classList.toggle('high-contrast');
  showToast(document.body.classList.contains('high-contrast') ? 'High contrast enabled' : 'Standard contrast restored');
});

renderPresets();
updateLineNumbers();
analyze();
