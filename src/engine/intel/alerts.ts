// Public alerts in the language of the people at risk. Each alert is written
// in English, Hindi and the regional language of the affected state, from
// short fixed templates (no machine translation). Review before sending.

import type { CityOutlook } from '../decision';
import type { EventTrack } from '../events';
import { kmh } from './phrases';

export type Lang = 'en' | 'hi' | 'te' | 'ta' | 'bn' | 'or' | 'gu' | 'mr' | 'ml' | 'kn';

export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  hi: 'हिन्दी',
  te: 'తెలుగు',
  ta: 'தமிழ்',
  bn: 'বাংলা',
  or: 'ଓଡ଼ିଆ',
  gu: 'ગુજરાતી',
  mr: 'मराठी',
  ml: 'മലയാളം',
  kn: 'ಕನ್ನಡ',
};

const STATE_LANG: Record<string, Lang> = {
  'Tamil Nadu': 'ta',
  Puducherry: 'ta',
  'Andhra Pradesh': 'te',
  Telangana: 'te',
  Odisha: 'or',
  'West Bengal': 'bn',
  Tripura: 'bn',
  Gujarat: 'gu',
  Maharashtra: 'mr',
  Kerala: 'ml',
  Karnataka: 'kn',
};

type Kind = 'cyclone' | 'heat' | 'rain' | 'cold';

const T: Record<Kind, Partial<Record<Lang, string>>> = {
  cyclone: {
    en: 'Cyclone alert: {name} is likely to cross the coast near {place} around {time} IST, with winds up to {wind} km/h. Fishermen must not go to sea. Stay indoors and follow official instructions.',
    hi: 'चक्रवात चेतावनी: {name} के {time} IST के आसपास {place} के निकट तट पार करने की संभावना है, हवा की गति {wind} किमी/घंटा तक। मछुआरे समुद्र में न जाएँ। घर के अंदर रहें और आधिकारिक निर्देशों का पालन करें।',
    te: 'తుఫాను హెచ్చరిక: {name} {time} IST సమయంలో {place} సమీపంలో తీరం దాటే అవకాశం ఉంది, గాలి వేగం గంటకు {wind} కి.మీ. వరకు. మత్స్యకారులు సముద్రంలోకి వెళ్లవద్దు. ఇంట్లోనే ఉండండి, అధికారుల సూచనలు పాటించండి.',
    ta: 'புயல் எச்சரிக்கை: {name} புயல் {time} IST அளவில் {place} அருகே கரையைக் கடக்க வாய்ப்பு உள்ளது, காற்றின் வேகம் மணிக்கு {wind} கி.மீ. வரை. மீனவர்கள் கடலுக்குச் செல்ல வேண்டாம். வீட்டிலேயே இருங்கள், அதிகாரிகளின் அறிவுறுத்தல்களைப் பின்பற்றுங்கள்.',
    bn: 'ঘূর্ণিঝড় সতর্কতা: {name} {time} IST নাগাদ {place}-এর কাছে উপকূল অতিক্রম করতে পারে, বাতাসের গতিবেগ ঘণ্টায় {wind} কিমি পর্যন্ত। মৎস্যজীবীরা সমুদ্রে যাবেন না। ঘরে থাকুন এবং সরকারি নির্দেশ মেনে চলুন।',
    or: 'ବାତ୍ୟା ସତର୍କତା: {name} {time} IST ବେଳକୁ {place} ନିକଟରେ ଉପକୂଳ ଅତିକ୍ରମ କରିବାର ସମ୍ଭାବନା ଅଛି, ପବନର ବେଗ ଘଣ୍ଟାକୁ {wind} କି.ମି. ପର୍ଯ୍ୟନ୍ତ। ମତ୍ସ୍ୟଜୀବୀମାନେ ସମୁଦ୍ରକୁ ଯାଆନ୍ତୁ ନାହିଁ। ଘର ଭିତରେ ରୁହନ୍ତୁ ଏବଂ ସରକାରୀ ନିର୍ଦ୍ଦେଶ ପାଳନ କରନ୍ତୁ।',
    gu: 'વાવાઝોડાની ચેતવણી: {name} {time} IST આસપાસ {place} નજીક દરિયાકાંઠો પાર કરે તેવી શક્યતા છે, પવનની ઝડપ કલાકે {wind} કિમી સુધી. માછીમારોએ દરિયામાં ન જવું. ઘરમાં રહો અને સરકારી સૂચનાઓનું પાલન કરો.',
    mr: 'चक्रीवादळ इशारा: {name} {time} IST च्या सुमारास {place} जवळ किनारा ओलांडण्याची शक्यता आहे, वाऱ्याचा वेग ताशी {wind} किमी पर्यंत. मच्छिमारांनी समुद्रात जाऊ नये. घरातच राहा आणि अधिकृत सूचनांचे पालन करा.',
    ml: 'ചുഴലിക്കാറ്റ് മുന്നറിയിപ്പ്: {name} {time} IST ഓടെ {place} ന് സമീപം തീരം കടക്കാൻ സാധ്യതയുണ്ട്, കാറ്റിന്റെ വേഗത മണിക്കൂറിൽ {wind} കി.മീ. വരെ. മത്സ്യത്തൊഴിലാളികൾ കടലിൽ പോകരുത്. വീടിനുള്ളിൽ തുടരുക, ഔദ്യോഗിക നിർദ്ദേശങ്ങൾ പാലിക്കുക.',
    kn: 'ಚಂಡಮಾರುತ ಎಚ್ಚರಿಕೆ: {name} {time} IST ಸುಮಾರಿಗೆ {place} ಬಳಿ ಕರಾವಳಿ ದಾಟುವ ಸಾಧ್ಯತೆ ಇದೆ, ಗಾಳಿಯ ವೇಗ ಗಂಟೆಗೆ {wind} ಕಿ.ಮೀ. ವರೆಗೆ. ಮೀನುಗಾರರು ಸಮುದ್ರಕ್ಕೆ ಹೋಗಬಾರದು. ಮನೆಯೊಳಗೆ ಇರಿ ಮತ್ತು ಅಧಿಕೃತ ಸೂಚನೆಗಳನ್ನು ಪಾಲಿಸಿ.',
  },
  heat: {
    en: 'Heat wave alert for {place} on {day}: temperatures up to {temp}°C. Avoid going out between 12 noon and 4 pm, drink plenty of water and check on elderly neighbours.',
    hi: '{place} के लिए {day} को लू की चेतावनी: तापमान {temp}°C तक। दोपहर 12 से 4 बजे के बीच बाहर जाने से बचें, खूब पानी पिएँ और बुज़ुर्गों का ध्यान रखें।',
    te: '{place}కు {day} వడగాలుల హెచ్చరిక: ఉష్ణోగ్రత {temp}°C వరకు. మధ్యాహ్నం 12 నుంచి 4 గంటల మధ్య బయటకు వెళ్లవద్దు, ఎక్కువ నీరు తాగండి, వృద్ధులను జాగ్రత్తగా చూసుకోండి.',
    ta: '{place} பகுதிக்கு {day} வெப்ப அலை எச்சரிக்கை: வெப்பநிலை {temp}°C வரை. மதியம் 12 முதல் 4 மணி வரை வெளியே செல்வதைத் தவிர்க்கவும், நிறைய தண்ணீர் குடிக்கவும், முதியவர்களைக் கவனித்துக் கொள்ளவும்.',
    bn: '{place}-এর জন্য {day} তাপপ্রবাহ সতর্কতা: তাপমাত্রা {temp}°C পর্যন্ত। দুপুর ১২টা থেকে ৪টা পর্যন্ত বাইরে যাবেন না, প্রচুর জল পান করুন এবং বয়স্কদের খেয়াল রাখুন।',
    or: '{place} ପାଇଁ {day} ତାପ ଲହରୀ ସତର୍କତା: ତାପମାତ୍ରା {temp}°C ପର୍ଯ୍ୟନ୍ତ। ଦିନ 12ଟାରୁ 4ଟା ମଧ୍ୟରେ ବାହାରକୁ ଯାଆନ୍ତୁ ନାହିଁ, ପ୍ରଚୁର ପାଣି ପିଅନ୍ତୁ ଏବଂ ବୟସ୍କମାନଙ୍କ ଯତ୍ନ ନିଅନ୍ତୁ।',
    gu: '{place} માટે {day} ગરમીના મોજાની ચેતવણી: તાપમાન {temp}°C સુધી. બપોરે 12 થી 4 વચ્ચે બહાર જવાનું ટાળો, પુષ્કળ પાણી પીઓ અને વડીલોનું ધ્યાન રાખો.',
    mr: '{place} साठी {day} उष्णतेच्या लाटेचा इशारा: तापमान {temp}°C पर्यंत. दुपारी 12 ते 4 दरम्यान बाहेर जाणे टाळा, भरपूर पाणी प्या आणि वृद्धांची काळजी घ्या.',
  },
  rain: {
    en: 'Heavy rain alert for {place} on {day}: up to {rain} mm in 24 hours. Avoid low-lying areas and waterlogged roads, and do not cross flowing water.',
    hi: '{place} के लिए {day} को भारी वर्षा की चेतावनी: 24 घंटे में {rain} मिमी तक। निचले इलाकों और जलभराव वाली सड़कों से बचें, बहते पानी को पार न करें।',
    te: '{place}కు {day} భారీ వర్ష హెచ్చరిక: 24 గంటల్లో {rain} మి.మీ. వరకు. లోతట్టు ప్రాంతాలు, నీరు నిలిచిన రోడ్లకు దూరంగా ఉండండి, ప్రవహించే నీటిని దాటవద్దు.',
    ta: '{place} பகுதிக்கு {day} கனமழை எச்சரிக்கை: 24 மணி நேரத்தில் {rain} மி.மீ. வரை. தாழ்வான பகுதிகளையும் தண்ணீர் தேங்கிய சாலைகளையும் தவிர்க்கவும், ஓடும் நீரைக் கடக்க வேண்டாம்.',
    bn: '{place}-এর জন্য {day} ভারী বৃষ্টির সতর্কতা: ২৪ ঘণ্টায় {rain} মিমি পর্যন্ত। নিচু এলাকা ও জলমগ্ন রাস্তা এড়িয়ে চলুন, স্রোতের জল পার হবেন না।',
    or: '{place} ପାଇଁ {day} ପ୍ରବଳ ବର୍ଷା ସତର୍କତା: 24 ଘଣ୍ଟାରେ {rain} ମି.ମି. ପର୍ଯ୍ୟନ୍ତ। ନିମ୍ନାଞ୍ଚଳ ଏବଂ ଜଳମଗ୍ନ ରାସ୍ତାରୁ ଦୂରେଇ ରୁହନ୍ତୁ, ବହୁଥିବା ପାଣି ପାର ହୁଅନ୍ତୁ ନାହିଁ।',
    gu: '{place} માટે {day} ભારે વરસાદની ચેતવણી: 24 કલાકમાં {rain} મિમી સુધી. નીચાણવાળા વિસ્તારો અને પાણી ભરાયેલા રસ્તાઓથી દૂર રહો, વહેતું પાણી પાર ન કરો.',
    mr: '{place} साठी {day} मुसळधार पावसाचा इशारा: 24 तासांत {rain} मिमी पर्यंत. सखल भाग आणि पाणी साचलेले रस्ते टाळा, वाहते पाणी ओलांडू नका.',
    ml: '{place} ന് {day} കനത്ത മഴ മുന്നറിയിപ്പ്: 24 മണിക്കൂറിൽ {rain} മി.മീ. വരെ. താഴ്ന്ന പ്രദേശങ്ങളും വെള്ളക്കെട്ടുള്ള റോഡുകളും ഒഴിവാക്കുക, ഒഴുകുന്ന വെള്ളം മുറിച്ചുകടക്കരുത്.',
    kn: '{place} ಗೆ {day} ಭಾರಿ ಮಳೆ ಎಚ್ಚರಿಕೆ: 24 ಗಂಟೆಗಳಲ್ಲಿ {rain} ಮಿ.ಮೀ. ವರೆಗೆ. ತಗ್ಗು ಪ್ರದೇಶಗಳು ಮತ್ತು ನೀರು ನಿಂತ ರಸ್ತೆಗಳಿಂದ ದೂರವಿರಿ, ಹರಿಯುವ ನೀರನ್ನು ದಾಟಬೇಡಿ.',
  },
  cold: {
    en: 'Cold wave alert for {place} on {day}: night temperatures down to {temp}°C. Keep warm, look after children and the elderly, and never burn coal in a closed room.',
    hi: '{place} के लिए {day} को शीतलहर की चेतावनी: रात का तापमान {temp}°C तक गिर सकता है। गर्म कपड़े पहनें, बच्चों और बुज़ुर्गों का ध्यान रखें, बंद कमरे में कोयला न जलाएँ।',
  },
};

export interface Alert {
  id: string;
  kind: Kind;
  title: string;
  region: string;
  eventId?: string;
  messages: { lang: Lang; text: string }[];
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function istStamp(analysis: number, t: number, withTime: boolean): string {
  const ms = analysis + t * 3600_000 + 5.5 * 3600_000;
  const d = new Date(Math.round(ms / 1_800_000) * 1_800_000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const date = `${dd}-${mm}-${d.getUTCFullYear()}`;
  if (!withTime) return date;
  return `${date} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function messages(kind: Kind, state: string, vars: Record<string, string>): { lang: Lang; text: string }[] {
  const langs: Lang[] = ['en', 'hi'];
  const regional = STATE_LANG[state];
  if (regional && T[kind][regional]) langs.push(regional);
  return langs.filter((l) => T[kind][l]).map((lang) => ({ lang, text: fill(T[kind][lang]!, vars) }));
}

export type AlertSampler = (cityId: string, type: 'heat' | 'rain' | 'cold', day: number) => number | null;

export function buildAlerts(events: EventTrack[], outlooks: CityOutlook[], analysis: number, sampler?: AlertSampler): Alert[] {
  const out: Alert[] = [];
  for (const ev of events) {
    if (ev.kind !== 'cyclone' || !ev.landfall || ev.landfall.t <= 0) continue;
    const lf = ev.landfall;
    const name = ev.name ?? ev.pendingName ?? ev.label;
    out.push({
      id: `cyc-${ev.id}`,
      kind: 'cyclone',
      title: `Cyclone landfall, ${lf.region}`,
      region: lf.region,
      eventId: ev.id,
      messages: messages('cyclone', lf.region, { name, place: lf.place, time: istStamp(analysis, lf.t, true), wind: String(kmh(lf.vmax)) }),
    });
  }
  const pick = (type: 'heat' | 'rain' | 'cold') => {
    let best: { o: CityOutlook; day: number; p: number } | null = null;
    for (const o of outlooks) {
      for (const d of o.days) {
        const h = d.hazards.find((x) => x.type === type);
        if (h && h.level >= 2 && (!best || h.level * 10 + h.p > best.p)) best = { o, day: d.day, p: h.level * 10 + h.p };
      }
    }
    return best;
  };
  const heat = pick('heat');
  if (heat) {
    out.push({
      id: `heat-${heat.o.city.id}`,
      kind: 'heat',
      title: `Heat wave, ${heat.o.city.name}`,
      region: heat.o.city.state,
      messages: messages('heat', heat.o.city.state, { place: heat.o.city.name, day: istStamp(analysis, heat.day * 24 - 12, false), temp: String(Math.round(sampler?.(heat.o.city.id, 'heat', heat.day) ?? 45)) }),
    });
  }
  const rain = pick('rain');
  if (rain) {
    out.push({
      id: `rain-${rain.o.city.id}`,
      kind: 'rain',
      title: `Heavy rain, ${rain.o.city.name}`,
      region: rain.o.city.state,
      messages: messages('rain', rain.o.city.state, { place: rain.o.city.name, day: istStamp(analysis, rain.day * 24 - 12, false), rain: String(Math.max(65, Math.round((sampler?.(rain.o.city.id, 'rain', rain.day) ?? 115) / 5) * 5)) }),
    });
  }
  const cold = pick('cold');
  if (cold) {
    out.push({
      id: `cold-${cold.o.city.id}`,
      kind: 'cold',
      title: `Cold wave, ${cold.o.city.name}`,
      region: cold.o.city.state,
      messages: messages('cold', cold.o.city.state, { place: cold.o.city.name, day: istStamp(analysis, cold.day * 24 - 12, false), temp: String(Math.round(sampler?.(cold.o.city.id, 'cold', cold.day) ?? 4)) }),
    });
  }
  return out;
}
