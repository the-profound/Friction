export type QuestionSurface = "question_queue" | "reading_question";
export type QuestionOutcome =
  | "exposed"
  | "answer_started"
  | "save_succeeded"
  | "save_failed"
  | "activated"
  | "activation_failed";

export type QuestionOpportunityProperties = {
  question_surface: QuestionSurface;
  question_opportunity_id: string;
  question_session_id: string;
  question_outcome: QuestionOutcome;
  question_aggregation_unit: "question_opportunity";
};

export function questionOpportunityProperties(params: {
  surface: QuestionSurface;
  opportunityKey: string;
  sessionKey: string;
  outcome: QuestionOutcome;
}): QuestionOpportunityProperties {
  return {
    question_surface: params.surface,
    question_opportunity_id: `${params.surface}:${params.opportunityKey}`,
    question_session_id: `${params.surface}:${params.sessionKey}`,
    question_outcome: params.outcome,
    question_aggregation_unit: "question_opportunity",
  };
}

export type QuestionMetricEvent = {
  surface: QuestionSurface;
  opportunityId: string;
  outcome: Extract<
    QuestionOutcome,
    "exposed" | "answer_started" | "save_succeeded" | "save_failed"
  >;
};

export type QuestionSurfaceMetric = {
  surface: QuestionSurface;
  exposed: number;
  answerStarted: number;
  saveSucceeded: number;
  saveFailed: number;
  conversionRate: number | null;
  exposureContribution: number;
  successContribution: number;
};

export type CombinedQuestionAnswerMetric = {
  exposed: number;
  answerStarted: number;
  saveSucceeded: number;
  saveFailed: number;
  conversionRate: number | null;
  surfaces: Record<QuestionSurface, QuestionSurfaceMetric>;
};

const SURFACES: QuestionSurface[] = ["question_queue", "reading_question"];

/**
 * Computes the item-opportunity funnel for one already-filtered analysis
 * period. Event retries are deduplicated by surface + opportunity + outcome.
 * The combined rate is total unique saves / total unique exposures, never an
 * average of the two surface rates.
 */
export function calculateCombinedQuestionAnswerMetric(
  events: readonly QuestionMetricEvent[],
): CombinedQuestionAnswerMetric {
  const sets = Object.fromEntries(
    SURFACES.map((surface) => [
      surface,
      {
        exposed: new Set<string>(),
        answer_started: new Set<string>(),
        save_succeeded: new Set<string>(),
        save_failed: new Set<string>(),
      },
    ]),
  ) as Record<
    QuestionSurface,
    Record<QuestionMetricEvent["outcome"], Set<string>>
  >;

  for (const event of events) {
    sets[event.surface][event.outcome].add(event.opportunityId);
  }

  const totals = SURFACES.map((surface) => ({
    surface,
    exposed: sets[surface].exposed.size,
    answerStarted: sets[surface].answer_started.size,
    saveSucceeded: sets[surface].save_succeeded.size,
    saveFailed: sets[surface].save_failed.size,
  }));
  const exposed = totals.reduce((sum, metric) => sum + metric.exposed, 0);
  const answerStarted = totals.reduce((sum, metric) => sum + metric.answerStarted, 0);
  const saveSucceeded = totals.reduce((sum, metric) => sum + metric.saveSucceeded, 0);
  const saveFailed = totals.reduce((sum, metric) => sum + metric.saveFailed, 0);

  const surfaces = Object.fromEntries(
    totals.map((metric) => [
      metric.surface,
      {
        ...metric,
        conversionRate:
          metric.exposed === 0 ? null : metric.saveSucceeded / metric.exposed,
        exposureContribution: exposed === 0 ? 0 : metric.exposed / exposed,
        successContribution:
          saveSucceeded === 0 ? 0 : metric.saveSucceeded / saveSucceeded,
      },
    ]),
  ) as Record<QuestionSurface, QuestionSurfaceMetric>;

  return {
    exposed,
    answerStarted,
    saveSucceeded,
    saveFailed,
    conversionRate: exposed === 0 ? null : saveSucceeded / exposed,
    surfaces,
  };
}