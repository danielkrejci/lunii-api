/**
 * The answers the profile questions accept — the codes, not the labels.
 *
 * A copy of the app's `form/profileOptions.ts`, and it has to stay one: the app offers
 * these and the server refuses anything else. Onboarding stored them unchecked, so rows
 * written before this list existed may hold other strings; only updates are held to it.
 */

export const RELATIONSHIP_STATUSES = [
    "single",
    "seeing_someone",
    "in_a_relationship",
    "married",
    "its_complicated",
    "prefer_not_to_say",
] as const;

export const CAREER_STAGES = [
    "studying",
    "working",
    "looking_for_work",
    "at_home",
    "retired",
    "something_else",
] as const;

export const DECISION_STYLES = [
    "by_instinct",
    "weigh_the_options",
    "ask_for_advice",
    "do_my_research",
    "meditate_on_it",
    "let_life_decide",
] as const;

export const AREAS_OF_INTEREST = [
    "career",
    "love",
    "health",
    "personal_growth",
    "finances",
    "family_and_friends",
    "creativity",
    "stability",
    "freedom",
] as const;

export const CONTENT_PREFERENCES = [
    "practical_advice",
    "emotional_support",
    "motivation",
    "deep_insights",
    "clarity_about_the_future",
    "just_something_fun",
] as const;

export const BELIEF_LEVELS = [
    "strongly_believe",
    "open_to_it",
    "enjoy_for_guidance",
    "just_for_fun",
    "not_sure",
] as const;
