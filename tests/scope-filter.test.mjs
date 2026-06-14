import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const engineSource = html.match(/<script id="learning-engine">([\s\S]*?)<\/script>/)?.[1] || "";
const appScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
const dataSource = appScript.slice(appScript.indexOf("const SUBJECTS="), appScript.indexOf("const STORE="));

const engineContext = {};
vm.createContext(engineContext);
vm.runInContext(`${engineSource};globalThis.scopeApi={
  defaultLearnedTopicIds,isQuestionAvailable,filterAvailableQuestions,skipUnlearnedTopic
}`, engineContext);
const scopeApi = engineContext.scopeApi;

const dataContext = {};
vm.createContext(dataContext);
vm.runInContext(`${dataSource};globalThis.mathData={topics:TOPICS,questions:QUESTIONS}`, dataContext);
const mathData = JSON.parse(JSON.stringify(dataContext.mathData));

test("grade 1 and 2 topics are learned by default", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(scopeApi.defaultLearnedTopicIds(mathData.topics))),
    mathData.topics.filter(topic => topic.grade < 3).map(topic => topic.id)
  );
});

test("all generated questions have curriculum scope metadata", () => {
  assert.equal(mathData.questions.length, 152);
  assert.ok(mathData.questions.every(question =>
    question.grade &&
    question.topicId &&
    question.topicName &&
    Array.isArray(question.prerequisites) &&
    question.difficulty
  ));
});

test("all selectable grade 3 math topics exist", () => {
  const names = new Set(mathData.topics.filter(topic => topic.grade === 3).map(topic => topic.name));
  for (const name of ["平方根", "二次方程式", "関数 y=ax²", "相似", "円", "三平方の定理", "標本調査"]) {
    assert.ok(names.has(name), `${name} is missing`);
  }
});

test("unlearned topics and unmet prerequisites are filtered", () => {
  const learned = ["math-positive-negative", "math-expressions"];
  assert.equal(scopeApi.isQuestionAvailable(
    { topicId: "math-expressions", prerequisites: ["math-positive-negative"] },
    learned
  ), true);
  assert.equal(scopeApi.isQuestionAvailable(
    { topicId: "math-square-roots", prerequisites: ["math-expressions"] },
    learned
  ), false);
  assert.equal(scopeApi.isQuestionAvailable(
    { topicId: "math-quadratic-equations", prerequisites: ["math-square-roots", "math-expressions"] },
    ["math-expressions", "math-quadratic-equations"]
  ), false);
});

test("skipping a topic preserves performance data and removes its deck questions", () => {
  const state = {
    learnedTopics: ["math-expressions", "math-square-roots"],
    attempts: 12,
    correct: 8,
    causes: { calculation: 3 },
    weak: { q1: 2 },
    history: [{ id: "q1", ok: false }]
  };
  const result = scopeApi.skipUnlearnedTopic(state, "math-square-roots", [
    { id: "q2", topicId: "math-square-roots" },
    { id: "q3", topicId: "math-expressions" }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(result.learnedTopics)), ["math-expressions"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.deck.map(question => question.id))), ["q3"]);
  for (const key of ["attempts", "correct", "causes", "weak", "history"]) {
    assert.deepEqual(JSON.parse(JSON.stringify(result[key])), state[key], `${key} changed`);
  }
});

test("every quiz entry point uses the shared availability filter", () => {
  for (const name of ["startUnit", "startDaily", "startWeak", "balanced", "retryWrong"]) {
    const body = appScript.match(new RegExp(`function ${name}\\([^)]*\\)\\{([\\s\\S]*?)\\n?\\}`))?.[1] || "";
    assert.match(body, /filterAvailableQuestions|availableQuestions/, `${name} bypasses scope filtering`);
  }
  assert.match(appScript, /function beginAvailableSession\(/);
  assert.match(appScript, /showScope\(\)/);
});

test("scope UI and Android inline handlers are present", () => {
  assert.match(html, /id=["']screen-scope["']/);
  assert.match(html, /まだ習っていない/);
  for (const handler of ["showScope", "toggleTopic", "saveScope", "markCurrentTopicUnlearned"]) {
    assert.match(html, new RegExp(`window\\.${handler}\\s*=\\s*${handler}\\s*;`));
  }
});

test("marking a topic unlearned does not ask for confirmation", () => {
  assert.doesNotMatch(html,/\bconfirm\s*\(/);
});
