import { describe, expect, it } from "vitest";
import {
  calculateCombinedQuestionAnswerMetric,
  questionOpportunityProperties,
  type QuestionMetricEvent,
} from "./questionAnswerMetrics";

describe("combined question answer metric", () => {
  it("namespaces common opportunity and session identities by surface", () => {
    const queue = questionOpportunityProperties({
      surface: "question_queue",
      opportunityKey: "same",
      sessionKey: "same",
      outcome: "exposed",
    });
    const reading = questionOpportunityProperties({
      surface: "reading_question",
      opportunityKey: "same",
      sessionKey: "same",
      outcome: "exposed",
    });

    expect(queue.question_opportunity_id).not.toBe(reading.question_opportunity_id);
    expect(queue.question_aggregation_unit).toBe("question_opportunity");
  });

  it("weights surfaces by opportunities rather than averaging rates", () => {
    const events: QuestionMetricEvent[] = [];
    for (let index = 0; index < 10; index += 1) {
      events.push({
        surface: "question_queue",
        opportunityId: `queue-${index}`,
        outcome: "exposed",
      });
    }
    events.push(
      { surface: "question_queue", opportunityId: "queue-0", outcome: "save_succeeded" },
      { surface: "reading_question", opportunityId: "reading-0", outcome: "exposed" },
      { surface: "reading_question", opportunityId: "reading-0", outcome: "answer_started" },
      { surface: "reading_question", opportunityId: "reading-0", outcome: "save_succeeded" },
    );

    const metric = calculateCombinedQuestionAnswerMetric(events);
    expect(metric.conversionRate).toBeCloseTo(2 / 11);
    expect(metric.conversionRate).not.toBeCloseTo((0.1 + 1) / 2);
    expect(metric.surfaces.question_queue.conversionRate).toBe(0.1);
    expect(metric.surfaces.reading_question.conversionRate).toBe(1);
    expect(metric.surfaces.question_queue.exposed + metric.surfaces.reading_question.exposed)
      .toBe(metric.exposed);
    expect(metric.surfaces.question_queue.saveSucceeded
      + metric.surfaces.reading_question.saveSucceeded).toBe(metric.saveSucceeded);
  });

  it("deduplicates retries for each opportunity and outcome", () => {
    const duplicate: QuestionMetricEvent = {
      surface: "question_queue",
      opportunityId: "queue-1",
      outcome: "exposed",
    };
    const metric = calculateCombinedQuestionAnswerMetric([duplicate, duplicate]);
    expect(metric.exposed).toBe(1);
  });
});