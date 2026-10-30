// Updates a live element to match new markup, changing only what differs. Elements that
// stay keep their identity, so images don't decode again, running animations and
// transitions aren't restarted, and scroll positions and focus survive a redraw.
//
// Children match by position and tag. Keyed elements match by key instead: an id, a
// data-key (unique among its siblings), or an <img>'s src. Give list items a key, so a
// list that gains, loses, or reorders an item moves nodes instead of rewriting them.
export function patch(root, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(root, tpl.content);
}

const keyOf = (node) => {
  if (node.nodeType !== 1) return null;
  if (node.id) return `#${node.id}`;
  if (node.dataset.key) return `key:${node.dataset.key}`;
  return node.nodeName === 'IMG' ? `img:${node.getAttribute('src')}` : null;
};

const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

function patchChildren(from, to) {
  const old = [...from.childNodes];
  const keyed = new Map();
  for (const node of old) {
    const key = keyOf(node);
    if (key && !keyed.has(key)) keyed.set(key, node);
  }
  let next = 0; // the next unkeyed old child to try
  const result = [];
  for (const node of [...to.childNodes]) {
    const key = keyOf(node);
    let match = null;
    if (key) {
      match = keyed.get(key);
      if (match && sameKind(match, node)) keyed.delete(key);
      else match = null;
    } else {
      // The next unkeyed old child of the same kind. Skipped ones are dropped, but only
      // once a match is found, so one new node with no match can't use up the rest.
      for (let j = next; j < old.length; j++) {
        if (!keyOf(old[j]) && sameKind(old[j], node)) {
          match = old[j];
          next = j + 1;
          break;
        }
      }
    }
    if (match) {
      patchNode(match, node);
      result.push(match);
    } else {
      result.push(node);
    }
  }
  // Put the children in order, then drop whatever wasn't reused.
  result.forEach((node, i) => {
    if (from.childNodes[i] !== node) from.insertBefore(node, from.childNodes[i] ?? null);
  });
  while (from.childNodes.length > result.length) from.lastChild.remove();
}

function patchNode(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of to.attributes) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  patchChildren(from, to);
}
