import { example, closure } from "./core.js";
const $ = (id) => document.getElementById(id);
const studies = {
  orders: example,
  tradeoff: {
    attributes: "Student, Course, Instructor",
    dependencies: "Student, Course -> Instructor\nInstructor -> Course",
    decomposition: "Instructor, Course\nStudent, Instructor",
  },
  lossy: {
    attributes: "Author, Country, Book, Publisher",
    dependencies: "Author -> Country\nBook -> Publisher",
    decomposition: "Author, Country\nBook, Publisher",
  },
  blank: {
    attributes: "A, B, C",
    dependencies: "A -> B\nB -> C",
    decomposition: "",
  },
};
let result = null,
  worker = null;
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function names(mask) {
  return result.attributes.filter((_, i) => mask & (1 << i)).join(", ") || "∅";
}
function rule(fd) {
  return `${names(fd.left)} → ${names(fd.right)}`;
}
function input() {
  return Object.fromEntries(
    ["attributes", "dependencies", "decomposition"].map((k) => [k, $(k).value]),
  );
}
function load(data) {
  for (const k of ["attributes", "dependencies", "decomposition"]) {
    if (typeof data[k] !== "string") throw Error(`Missing ${k} text.`);
    $(k).value = data[k];
  }
}
function run() {
  worker?.terminate();
  $("analyze").disabled = true;
  $("status").textContent = "Checking every attribute subset…";
  $("result").hidden = true;
  worker = new Worker("./worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    $("analyze").disabled = false;
    worker.terminate();
    worker = null;
    if (data.error) {
      $("status").textContent = data.error;
      return;
    }
    result = data.result;
    $("status").textContent =
      `Checked ${2 ** result.attributes.length} attribute subsets. Results reflect the last unfolded schema.`;
    render();
  };
  worker.onerror = () => {
    $("analyze").disabled = false;
    $("status").textContent =
      "Analysis could not finish. Reload and try again.";
    worker?.terminate();
    worker = null;
  };
  worker.postMessage(input());
}
function render() {
  $("result").hidden = false;
  $("normal").textContent = result.original.normalForm;
  $("keys").replaceChildren(
    ...result.original.keys.map((k) => el("span", names(k), "key")),
  );
  $("diagnosis").textContent =
    result.original.normalForm === "BCNF"
      ? "Every nontrivial implied dependency has a superkey determinant."
      : result.original.normalForm === "3NF"
        ? "Every non-superkey dependency targets a prime attribute. This meets 3NF, but not BCNF."
        : "At least one non-superkey dependency targets a non-prime attribute. Splitting the relation can reduce redundancy.";
  const violations = result.original.violations;
  $("violations").replaceChildren(
    ...violations.slice(0, 12).map((v) => {
      const p = el("div", rule(v), "rule");
      p.append(
        el(
          "small",
          v.third
            ? "Violates 3NF and BCNF: the determinant is not a superkey and the target is not prime."
            : "Violates BCNF; permitted in 3NF because the target belongs to a candidate key.",
        ),
      );
      return p;
    }),
  );
  if (!violations.length)
    $("violations").append(
      el("p", "No violations among all nontrivial implied dependencies."),
    );
  if (violations.length > 12)
    $("violations").append(
      el(
        "p",
        `Showing 12 of ${violations.length} violations. The evidence export contains all of them.`,
      ),
    );
  $("design").querySelector("[value=custom]").disabled = !result.custom;
  if (!$("design").value || !result[$("design").value])
    $("design").value = "third";
  $("cover").replaceChildren(
    ...result.cover.map((f) => el("div", rule(f), "rule")),
  );
  if (!result.cover.length)
    $("cover").append(el("p", "No nontrivial dependencies."));
  $("closure-input").replaceChildren(el("legend", "Known attributes"));
  result.attributes.forEach((name, i) => {
    const label = el("label");
    const check = el("input");
    check.type = "checkbox";
    check.value = String(1 << i);
    check.checked = Boolean(result.original.keys[0] & (1 << i));
    check.addEventListener("change", renderClosure);
    label.append(check, document.createTextNode(name));
    $("closure-input").append(label);
  });
  renderClosure();
  renderDesign();
}
function renderClosure() {
  const seed = [...$("closure-input").querySelectorAll("input:checked")].reduce(
      (m, e) => m | Number(e.value),
      0,
    ),
    trace = [],
    end = closure(seed, result.fds, trace);
  $("closure-result").replaceChildren(
    el("p", `{${names(seed)}}⁺ = {${names(end)}}`),
  );
  trace.forEach((s, i) =>
    $("closure-result").append(
      el("div", `${i + 1}. ${rule(s)}  ⇒  {${names(s.after)}}`, "rule"),
    ),
  );
  if (!trace.length)
    $("closure-result").append(el("p", "No rule adds a new attribute."));
}
function current() {
  return result[$("design").value];
}
function renderDesign() {
  const design = current();
  if (!design) return;
  $("verdict").textContent =
    `${design.chase.lossless ? "Lossless join" : "Lossy join"} · ${design.preserved ? "All declared dependencies preserved" : "Some dependencies require joins to enforce"}`;
  $("verdict").className =
    `verdict${!design.chase.lossless || !design.preserved ? " warning" : ""}`;
  $("relations").replaceChildren(
    ...design.components.map((c, i) => {
      const card = el("article", undefined, "relation");
      card.append(el("h3", `Relation ${i + 1} / ${c.normalForm}`));
      const p = el("p");
      result.attributes.forEach((name, j) => {
        if (c.relation & (1 << j)) {
          if (p.childNodes.length) p.append(document.createTextNode(" · "));
          p.append(el("span", name, c.keys[0] & (1 << j) ? "under" : ""));
        }
      });
      card.append(
        p,
        el(
          "small",
          `Keys: ${c.keys.map(names).join(" / ")}. First key underlined.`,
        ),
      );
      return card;
    }),
  );
  $("tradeoff").textContent =
    $("design").value === "third"
      ? "Synthesis groups a minimal cover and adds a candidate-key relation when needed. Every resulting relation meets at least 3NF."
      : $("design").value === "bcnf"
        ? "BCNF recursively splits on a non-superkey determinant. It guarantees lossless reconstruction, but may lose dependency preservation."
        : "Your proposed relations are checked against the full implied dependencies, including paths through attributes outside each fragment.";
  $("preservation").replaceChildren(
    ...design.checks.map((c) => {
      const p = el("div", `${c.preserved ? "✓" : "×"} ${rule(c)}`, "rule");
      p.append(
        el(
          "small",
          `Closure under the union of projected dependencies: {${names(c.derived)}}`,
        ),
      );
      return p;
    }),
  );
  if (!design.checks.length)
    $("preservation").append(el("p", "No dependencies were declared."));
  $("chase-explanation").textContent = design.chase.lossless
    ? `The chase produces a fully distinguished row (relation ${design.chase.witness + 1}). Rejoining these projections is lossless for every relation satisfying the declared dependencies.`
    : "No fully distinguished row appears at the fixed point. Some valid data can produce spurious tuples when these projections are joined.";
  $("step").max = design.chase.steps.length;
  $("step").value = design.chase.steps.length;
  renderChase();
}
function renderChase() {
  const chase = current().chase,
    index = Number($("step").value),
    step = chase.steps[index - 1],
    table = step?.table || chase.initial;
  $("step-label").textContent = step
    ? `Step ${index} / ${chase.steps.length}: rows ${step.rows.map((x) => x + 1).join(" and ")} agree on {${names(step.left)}}. Apply ${rule(step)}.`
    : "Initial tableau: each relation contributes one row.";
  const node = el("table"),
    head = el("tr");
  head.append(
    el("th", "Relation"),
    ...result.attributes.map((n) => el("th", n)),
  );
  const thead = el("thead");
  thead.append(head);
  node.append(thead);
  const body = el("tbody");
  table.forEach((row, i) => {
    const tr = el("tr");
    if (row.every((x, j) => x === j)) tr.className = "witness";
    tr.append(
      el("td", String(i + 1)),
      ...row.map((x, j) =>
        el(
          "td",
          x === j ? `a${j + 1}` : `b${x - result.attributes.length + 1}`,
        ),
      ),
    );
    body.append(tr);
  });
  node.append(body);
  $("table").replaceChildren(node);
}
function download(name, data) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2) + "\n"], {
        type: "application/json",
      }),
    ),
    a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});
$("study").addEventListener("change", () => {
  load(studies[$("study").value]);
  $("design").value =
    $("study").value === "lossy"
      ? "custom"
      : $("study").value === "tradeoff"
        ? "bcnf"
        : "third";
  run();
});
$("design").addEventListener("change", renderDesign);
$("step").addEventListener("input", renderChase);
$("save").addEventListener("click", () =>
  download("relation-study.json", result.input),
);
$("export").addEventListener("click", () =>
  download("relation-evidence.json", {
    format: "relation-fold-evidence-v1",
    encoding:
      "Attribute sets are bitmasks; bit i names attributes[i]. Chase symbols 0..n-1 are distinguished column values.",
    ...result,
  }),
);
$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", async () => {
  const file = $("file").files[0];
  if (!file) return;
  try {
    if (file.size > 50000) throw Error("Study files must be at most 50 KB.");
    const data = JSON.parse(await file.text());
    for (const key of ["attributes", "dependencies", "decomposition"])
      if (typeof data[key] !== "string" || data[key].length > 12000)
        throw Error(
          "Expected bounded attributes, dependencies, and decomposition text.",
        );
    load(data);
    run();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("file").value = "";
  }
});
load(example);
run();
