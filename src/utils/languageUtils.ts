import { Gender } from "./natalUtils";

/**
 * How the app addresses the reader in this language.
 *
 * `informal` is the T-form where the language has one — ty, du, tu, jij. The app's own
 * UI is informal, and a horoscope that switches to the formal form mid-screen reads as a
 * different product than the button above it. In languages that draw no such distinction
 * it changes nothing.
 *
 * `polite` is for languages with politeness levels rather than a T/V pair, where the
 * plain form from an app would read as rude rather than friendly. It is the everyday
 * register, not deference.
 */
export type AddressForm = "informal" | "polite";

export type Language = {
    name: string;
    iso: string;
    dayjsLocale: string;
    appleLocale: string;
    addressForm: AddressForm;
    countries: { name: string; iso: string }[];
};

export const languagesData: Language[] = [
    {
        name: "English",
        iso: "en",
        dayjsLocale: "en",
        appleLocale: "en_US",
        addressForm: "informal",
        countries: [
            { name: "United States", iso: "US" },
            { name: "United Kingdom", iso: "GB" },
            { name: "Canada", iso: "CA" },
            { name: "Australia", iso: "AU" },
            { name: "Ireland", iso: "IE" },
            { name: "New Zealand", iso: "NZ" },
        ],
    },
    {
        name: "Español",
        iso: "es",
        dayjsLocale: "es",
        appleLocale: "es_ES",
        addressForm: "informal",
        countries: [
            { name: "Spain", iso: "ES" },
            { name: "Mexico", iso: "MX" },
            { name: "Argentina", iso: "AR" },
            { name: "Colombia", iso: "CO" },
            { name: "Chile", iso: "CL" },
        ],
    },
    {
        name: "Português",
        iso: "pt",
        dayjsLocale: "pt",
        appleLocale: "pt_PT",
        addressForm: "informal",
        countries: [
            { name: "Portugal", iso: "PT" },
            { name: "Brazil", iso: "BR" },
        ],
    },
    {
        name: "Deutsch",
        iso: "de",
        dayjsLocale: "de",
        appleLocale: "de_DE",
        addressForm: "informal",
        countries: [
            { name: "Germany", iso: "DE" },
            { name: "Austria", iso: "AT" },
            { name: "Switzerland", iso: "CH" },
        ],
    },
    {
        name: "Français",
        iso: "fr",
        dayjsLocale: "fr",
        appleLocale: "fr_FR",
        addressForm: "informal",
        countries: [
            { name: "France", iso: "FR" },
            { name: "Canada", iso: "CA" },
            { name: "Belgium", iso: "BE" },
            { name: "Switzerland", iso: "CH" },
        ],
    },
    {
        name: "Italiano",
        iso: "it",
        dayjsLocale: "it",
        appleLocale: "it_IT",
        addressForm: "informal",
        countries: [
            { name: "Italy", iso: "IT" },
            { name: "Switzerland", iso: "CH" },
        ],
    },
    {
        name: "Nederlands",
        iso: "nl",
        dayjsLocale: "nl",
        appleLocale: "nl_NL",
        addressForm: "informal",
        countries: [
            { name: "Netherlands", iso: "NL" },
            { name: "Belgium", iso: "BE" },
        ],
    },
    {
        name: "Svenska",
        iso: "sv",
        dayjsLocale: "sv",
        appleLocale: "sv_SE",
        addressForm: "informal",
        countries: [{ name: "Sweden", iso: "SE" }],
    },
    {
        name: "Dansk",
        iso: "da",
        dayjsLocale: "da",
        appleLocale: "da_DK",
        addressForm: "informal",
        countries: [{ name: "Denmark", iso: "DK" }],
    },
    {
        name: "Norsk",
        iso: "nb",
        dayjsLocale: "nb",
        appleLocale: "nb_NO",
        addressForm: "informal",
        countries: [{ name: "Norway", iso: "NO" }],
    },
    {
        name: "Suomi",
        iso: "fi",
        dayjsLocale: "fi",
        appleLocale: "fi_FI",
        addressForm: "informal",
        countries: [{ name: "Finland", iso: "FI" }],
    },
    {
        name: "Polski",
        iso: "pl",
        dayjsLocale: "pl",
        appleLocale: "pl_PL",
        addressForm: "informal",
        countries: [{ name: "Poland", iso: "PL" }],
    },
    {
        name: "Čeština",
        iso: "cs",
        dayjsLocale: "cs",
        appleLocale: "cs_CZ",
        addressForm: "informal",
        countries: [{ name: "Czechia", iso: "CZ" }],
    },
    {
        name: "Slovenčina",
        iso: "sk",
        dayjsLocale: "sk",
        appleLocale: "sk_SK",
        addressForm: "informal",
        countries: [{ name: "Slovakia", iso: "SK" }],
    },
    {
        name: "Magyar",
        iso: "hu",
        dayjsLocale: "hu",
        appleLocale: "hu_HU",
        addressForm: "informal",
        countries: [{ name: "Hungary", iso: "HU" }],
    },
    {
        name: "Română",
        iso: "ro",
        dayjsLocale: "ro",
        appleLocale: "ro_RO",
        addressForm: "informal",
        countries: [{ name: "Romania", iso: "RO" }],
    },
    {
        name: "Ελληνικά",
        iso: "el",
        dayjsLocale: "el",
        appleLocale: "el_GR",
        addressForm: "informal",
        countries: [{ name: "Greece", iso: "GR" }],
    },
    {
        name: "Türkçe",
        iso: "tr",
        dayjsLocale: "tr",
        appleLocale: "tr_TR",
        addressForm: "informal",
        countries: [{ name: "Turkey", iso: "TR" }],
    },
    {
        name: "Українська",
        iso: "uk",
        dayjsLocale: "uk",
        appleLocale: "uk_UA",
        addressForm: "informal",
        countries: [{ name: "Ukraine", iso: "UA" }],
    },
    {
        name: "العربية",
        iso: "ar",
        dayjsLocale: "ar",
        appleLocale: "ar_SA",
        addressForm: "informal",
        countries: [
            { name: "United Arab Emirates", iso: "AE" },
            { name: "Saudi Arabia", iso: "SA" },
            { name: "Egypt", iso: "EG" },
        ],
    },
    {
        // आप rather than तुम: the polite form is what an Indian app uses with a stranger,
        // and the familiar one reads as over-stepping rather than warm.
        name: "हिन्दी",
        iso: "hi",
        dayjsLocale: "hi",
        appleLocale: "hi_IN",
        addressForm: "polite",
        countries: [{ name: "India", iso: "IN" }],
    },
    {
        // Anda rather than kamu, for the same reason as Hindi.
        name: "Bahasa Indonesia",
        iso: "id",
        dayjsLocale: "id",
        appleLocale: "id_ID",
        addressForm: "polite",
        countries: [{ name: "Indonesia", iso: "ID" }],
    },
    {
        // 你 is the ordinary second person here, not a familiar form — 您 would be the
        // formal one, so "informal" is the neutral choice rather than a casual one.
        name: "中文",
        iso: "zh",
        dayjsLocale: "zh-cn",
        appleLocale: "zh_CN",
        addressForm: "informal",
        countries: [
            { name: "Taiwan", iso: "TW" },
            { name: "China", iso: "CN" },
        ],
    },
    {
        // Politeness levels rather than a T/V pair. The plain form from an app is not
        // friendly, it is rude — です/ます is the register a product speaks in.
        name: "日本語",
        iso: "ja",
        dayjsLocale: "ja",
        appleLocale: "ja_JP",
        addressForm: "polite",
        countries: [{ name: "Japan", iso: "JP" }],
    },
    {
        // As Japanese: 해요체, not 해체.
        name: "한국어",
        iso: "ko",
        dayjsLocale: "ko",
        appleLocale: "ko_KR",
        addressForm: "polite",
        countries: [{ name: "South Korea", iso: "KR" }],
    },
];

const ADDRESS_FORM_RULE: Record<AddressForm, string> = {
    informal: `Address the reader with the informal second person the language keeps for someone you know — ty, du, tu, jij, tú. Never the formal or polite-plural form. In languages that draw no such distinction this changes nothing.`,
    polite: `Address the reader in the everyday polite register a product uses with an ordinary user — です/ます in Japanese, 해요체 in Korean, आप in Hindi, Anda in Indonesian. Warm and ordinary, neither deferential nor distant.`,
};

/**
 * Written out per gender rather than interpolated, because the non-binary case is not the
 * same instruction with a word swapped: several of these languages have no gender-neutral
 * way to address someone in the past tense at all, and a model told to "write neutrally"
 * picks one anyway.
 */
const GENDER_RULE: Record<Gender, string> = {
    male: `The reader is male. In languages that inflect for the addressee's gender — past tense, participles, adjectives — every form addressed to them is masculine.`,
    female: `The reader is female. In languages that inflect for the addressee's gender — past tense, participles, adjectives — every form addressed to them is feminine.`,
    non_binary: `The reader is non-binary. Many of these languages cannot address someone in the past tense without choosing a gender, and choosing one would misgender them — so write around it rather than picking. Prefer the present tense, impersonal and noun-based constructions, and verbs that carry no gendered participle. Never settle on a gender to make a sentence work; rewrite the sentence.`,
};

/**
 * Spelling and grammar as a hard requirement rather than an assumption.
 *
 * Worth stating because the failures observed were not stylistic: dropped diacritics
 * ("obzvlášt", "méné"), a wrong stem ("buděš"), a conjunction spelled as a preposition
 * ("ze" for "že"), a broken conditional ("aby si si udržel"), and sentences run together
 * without a space. A reader forgives a dull horoscope; a misspelt one reads as broken
 * software.
 */
const correctnessRule = (
    language: Language
) => `Write correct, idiomatic ${language.name}. This is not a style preference — it is a
requirement, and it matters more than anything else in these instructions.

Every accent and diacritic must be present and correct. Conditional and reflexive forms
must be built properly. Every sentence ends with punctuation followed by a single space.

Before you return the JSON, read every field you wrote once more and fix any spelling,
agreement, or spacing mistake. Do not rely on it having come out right the first time.`;

export function getLanguageByIso(iso: string): Language | undefined {
    return languagesData.find((l) => l.iso === iso);
}

/**
 * The whole "how do I address this person" rule for a prompt: which language, which form
 * of "you", and which gendered forms. All three are the same question, and answering
 * them in one place is what stops the four prompts from drifting into three different
 * registers for the same reader.
 */
export function buildPromptLanguageRule(language: Language, gender: Gender) {
    return `${language.name} (${language.appleLocale}, ${language.iso})

${ADDRESS_FORM_RULE[language.addressForm]}

${GENDER_RULE[gender]}

${correctnessRule(language)}`;
}
