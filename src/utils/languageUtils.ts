export const languagesData = [
    {
        name: "English",
        iso: "en",
        dayjsLocale: "en",
        appleLocale: "en_US",
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
        countries: [{ name: "Sweden", iso: "SE" }],
    },
    {
        name: "Dansk",
        iso: "da",
        dayjsLocale: "da",
        appleLocale: "da_DK",
        countries: [{ name: "Denmark", iso: "DK" }],
    },
    {
        name: "Norsk",
        iso: "nb",
        dayjsLocale: "nb",
        appleLocale: "nb_NO",
        countries: [{ name: "Norway", iso: "NO" }],
    },
    {
        name: "Suomi",
        iso: "fi",
        dayjsLocale: "fi",
        appleLocale: "fi_FI",
        countries: [{ name: "Finland", iso: "FI" }],
    },
    {
        name: "Polski",
        iso: "pl",
        dayjsLocale: "pl",
        appleLocale: "pl_PL",
        countries: [{ name: "Poland", iso: "PL" }],
    },
    {
        name: "Čeština",
        iso: "cs",
        dayjsLocale: "cs",
        appleLocale: "cs_CZ",
        countries: [{ name: "Czechia", iso: "CZ" }],
    },
    {
        name: "Slovenčina",
        iso: "sk",
        dayjsLocale: "sk",
        appleLocale: "sk_SK",
        countries: [{ name: "Slovakia", iso: "SK" }],
    },
    {
        name: "Magyar",
        iso: "hu",
        dayjsLocale: "hu",
        appleLocale: "hu_HU",
        countries: [{ name: "Hungary", iso: "HU" }],
    },
    {
        name: "Română",
        iso: "ro",
        dayjsLocale: "ro",
        appleLocale: "ro_RO",
        countries: [{ name: "Romania", iso: "RO" }],
    },
    {
        name: "Ελληνικά",
        iso: "el",
        dayjsLocale: "el",
        appleLocale: "el_GR",
        countries: [{ name: "Greece", iso: "GR" }],
    },
    {
        name: "Türkçe",
        iso: "tr",
        dayjsLocale: "tr",
        appleLocale: "tr_TR",
        countries: [{ name: "Turkey", iso: "TR" }],
    },
    {
        name: "Українська",
        iso: "uk",
        dayjsLocale: "uk",
        appleLocale: "uk_UA",
        countries: [{ name: "Ukraine", iso: "UA" }],
    },
    {
        name: "العربية",
        iso: "ar",
        dayjsLocale: "ar",
        appleLocale: "ar_SA",
        countries: [
            { name: "United Arab Emirates", iso: "AE" },
            { name: "Saudi Arabia", iso: "SA" },
            { name: "Egypt", iso: "EG" },
        ],
    },
    {
        name: "हिन्दी",
        iso: "hi",
        dayjsLocale: "hi",
        appleLocale: "hi_IN",
        countries: [{ name: "India", iso: "IN" }],
    },
    {
        name: "Bahasa Indonesia",
        iso: "id",
        dayjsLocale: "id",
        appleLocale: "id_ID",
        countries: [{ name: "Indonesia", iso: "ID" }],
    },
    {
        name: "中文",
        iso: "zh",
        dayjsLocale: "zh-cn",
        appleLocale: "zh_CN",
        countries: [
            { name: "Taiwan", iso: "TW" },
            { name: "China", iso: "CN" },
        ],
    },
    {
        name: "日本語",
        iso: "ja",
        dayjsLocale: "ja",
        appleLocale: "ja_JP",
        countries: [{ name: "Japan", iso: "JP" }],
    },
    {
        name: "한국어",
        iso: "ko",
        dayjsLocale: "ko",
        appleLocale: "ko_KR",
        countries: [{ name: "South Korea", iso: "KR" }],
    },
];

export type Language = {
    name: string;
    iso: string;
    dayjsLocale: string;
    appleLocale: string;
    countries: { name: string; iso: string }[];
};

export function getLanguageByIso(iso: string): Language | undefined {
    return languagesData.find((l) => l.iso === iso);
}

export function buildPromptLanguageRule(language: Language) {
    return `${language.name} (${language.appleLocale}, ${language.iso})`;
}
