import type { Answers } from "../jev/types";
import type { Config } from "./config";
import type { Gate, Route } from "./types";

/** F-2: decision confidence = the minimum confidence across the questions that gate it. */
export function gateConfidence(answers: Answers, questionIds: string[]): Gate {
  let confidence = Infinity;
  let weakest: string | null = null;
  for (const id of questionIds) {
    const a = answers[id];
    if (!a) return { confidence: null, weakest: id, questions: questionIds };
    if (a.confidence < confidence) {
      confidence = a.confidence;
      weakest = id;
    }
  }
  return { confidence: Number.isFinite(confidence) ? confidence : null, weakest, questions: questionIds };
}

/** F-3: AUTO at/above auto threshold, REVIEW between, HUMAN below. Null confidence is never AUTO. */
export function routeFor(confidence: number | null, t: Config["thresholds"]): Exclude<Route, "BLOCKED"> {
  if (confidence === null) return "HUMAN";
  if (confidence >= t.auto) return "AUTO";
  if (confidence >= t.review) return "REVIEW";
  return "HUMAN";
}

/** Money hard rule: a money action can be REVIEW at most, never AUTO. */
export function capAtReview(route: Exclude<Route, "BLOCKED">): Exclude<Route, "BLOCKED"> {
  return route === "AUTO" ? "REVIEW" : route;
}

export function band(confidence: number | null, t: Config["thresholds"]): "AUTO" | "REVIEW" | "HUMAN" {
  return routeFor(confidence, t);
}
