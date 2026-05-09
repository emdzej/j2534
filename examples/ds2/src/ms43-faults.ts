/**
 * BMW MS43 DS2 Fault Decoder
 *
 * Fault code tables extracted from BMW EDIABAS SGBD MS430DS0.prg:
 * - FORTTEXTE: Fault location codes (ORT) → description
 * - FARTTEXTE: Fault type codes (ART) → description
 * - FUMWELTTEXTE: Fault environment conditions → name, unit, scaling
 * - FARTMATRIX: ORT → ART mapping (per-fault type matrix)
 *
 * DS2 fault memory response format (service 0x04, subcommand 0x00):
 *   [addr] [len] [ack=0xA0] [fault_count] [op_hours_hi] [op_hours_lo]
 *   [ORT_0] [ART_0] [UW1_0] [UW2_0] [UW3_0] [UW4_0]
 *   [ORT_1] [ART_1] [UW1_1] [UW2_1] [UW3_1] [UW4_1]
 *   ...
 *   [checksum]
 *
 * Each fault entry = 6 bytes: location + type + 4 environment condition values.
 * Environment condition IDs are defined per-fault in the FORTTEXTE UW_1..UW_4 columns.
 */

// ─── Fault Location Table (FORTTEXTE) ─────────────────────────────
// ORT code → German description text
// Source: MS430DS0.prg table FORTTEXTE, 170 entries

export const FAULT_LOCATIONS: Record<number, string> = {
  0x01: "Zuendung Zyl. 2",
  0x02: "Zuendung Zyl. 4",
  0x03: "Zuendung Zyl. 6",
  0x05: "Einspritzventil Zylinder 2",
  0x06: "Einspritzventil Zylinder 1",
  0x08: "Luftmassenmesser",
  0x0A: "TKW",
  0x0B: "Kuehlerausgangstemperatur",
  0x0C: "TKW-MAX Plausibilitaet",
  0x0D: "Plausibilitaet Kuehlerauslasstemperatur",
  0x0E: "TAL",
  0x0F: "Plausibilitaet Abstellzeit",
  0x10: "Plausibilitaet Ansauglufttemperatur",
  0x11: "Plausibilitaet Motorkuehlwassertemperatur",
  0x12: "NW_A - Fehler",
  0x13: "VANOS-Magnetventil Auslass-NW",
  0x15: "VANOS-Magnetventil Einlass-NW",
  0x16: "Einspritzventil Zylinder 3",
  0x17: "Einspritzventil Zylinder 6",
  0x18: "Einspritzventil Zylinder 4",
  0x19: "Lambdasondenheizung Bank 1",
  0x1B: "LLFS schliessende Spule elektrisch",
  0x1D: "Zuendung Zyl. 1",
  0x1E: "Zuendung Zyl. 3",
  0x1F: "Zuendung Zyl. 5",
  0x21: "Einspritzventil Zylinder 5",
  0x23: "Relais Sekundaerluftpumpe",
  0x24: "Hauptrelais",
  0x25: "Schaltverzoegerung Hauptrelais",
  0x26: "Kupplungsschalter defekt",
  0x27: "BLS-BTS-Plausibilisierung",
  0x2A: "MFL-redundante Codierung des Signals",
  0x2B: "MFL-Wipptaster",
  0x2D: "MFL-Toggle-Bit",
  0x2F: "Momentenbegrenzung Sicherheitskonzept Ebene1",
  0x30: "Monitoring Steuergeraete Selbsttest 1",
  0x31: "Monitoring ERR_TQI_AV_MON",
  0x32: "Monitoring ERR_TQI_N_MAX_MON",
  0x33: "Monitoring ERR_TQI_N_MAX_NVMY_MON",
  0x34: "Abgasklappe",
  0x35: "LLFS oeffnende Spule elektrisch",
  0x37: "Lambdasondenheizung Bank 2",
  0x38: "ZSR Messwiderstand",
  0x39: "Klopfsensor 1",
  0x3A: "Monitoring Steuergeraete Selbsttest 2",
  0x3B: "Klopfsensor 2",
  0x3D: "Lambdasondenheizung nach Kat Bank 2",
  0x3E: "Sekundaerluftventil",
  0x3F: "Signal CAN Umgebungstemperatur",
  0x40: "Plausibilitaet Umgebungstemperatur",
  0x41: "NW_E- Fehler",
  0x42: "Monitoring Steuergeraete Selbsttest 4",
  0x43: "Monitoring Steuergeraete Selbsttest 5",
  0x44: "Tankentlueftungsventil",
  0x45: "Kraftstoffpumpenrelais",
  0x46: "Monitoring Steuergeraete Selbsttest 6",
  0x47: "Monitoring Steuergeraete Selbsttest 7",
  0x4A: "Relais Klimakompressor",
  0x4F: "Lambdasondenheizung nach Kat Bank 1",
  0x53: "KW - Fehler",
  0x5A: "TEG_UP_1",
  0x5B: "TEG_UP_2",
  0x5C: "TEG_DOWN_1",
  0x5D: "TEG_DOWN_2",
  0x5E: "Fehler Sekundaerluftmassenmesser",
  0x5F: "SAV oder SA-Schlauch blockiert",
  0x60: "Sekundaerluftpumpe nicht aktiv",
  0x61: "SA-Durchsatz zu gering",
  0x62: "SA-Durchsatz zu gross",
  0x63: "Sekundaerluftventil klemmt offen",
  0x64: "Steuergeraetefehler",
  0x67: "Regelvanos mechanisch Einlass",
  0x68: "Regelvanos mechanisch Auslass",
  0x69: "Regelvanos mech. Einlass schwergaengig oder blockiert",
  0x6A: "Regelvanos mech. Auslass schwergaengig oder blockiert",
  0x6D: "Endstufen-Fehler",
  0x6E: "Pedalwertsensor 1",
  0x6F: "Pedalwertsensor 2",
  0x70: "Drosselklappensensor 1",
  0x71: "Drosselklappensensor 2",
  0x72: "PVS-Plausibilitaet",
  0x73: "TPS-Adaption",
  0x75: "PVS_RATIO",
  0x76: "TPS-MAF Unplausibilitaet",
  0x77: "TPS-MAF Unplausibilitaet",
  0x78: "Unplausibilitaet Gas + Bremse",
  0x7A: "Temperaturfuehler Oel",
  0x7B: "Thermostatheizung, KFK",
  0x7C: "Variable Sauganlage",
  0x7D: "E-Luefter",
  0x7E: "Endstufenfehler DMTL-Ventil",
  0x80: "EWS-Uebertragung/-Parity",
  0x81: "Timeout SSG - Botschaft",
  0x82: "Timeout CAN-Botschaft ASC1",
  0x83: "Timeout CAN-Botschaft INSTR2",
  0x84: "Timeout CAN-Botschaft INSTR3",
  0x85: "Timeout CAN-Botschaft ASC3",
  0x86: "SSG-Eingriff unplausibel",
  0x87: "TPS-Startpruefung",
  0x88: "TPS-Startpruefung",
  0x89: "Timeout CAN-Botschaft LWS1",
  0x8B: "Signal CAN Tankfuellstand",
  0x8C: "Endstufenfehler DMTL-Pumpe",
  0x8D: "Plausibilitaet Tankfuellstand",
  0x8E: "Modulfehler DMTL",
  0x8F: "Tankleckdiagnose mit DMTL",
  0x92: "VCC-Poti 1",
  0x93: "VCC-Poti 2",
  0x95: "LM_HFM",
  0x96: "Lambdasondenspannung Vor-KAT-Sonde 1",
  0x97: "Lambdasondenspannung Vor-KAT-Sonde 2",
  0x98: "Lambdasondenspannung Nach-KAT-Sonde 1",
  0x99: "Lambdasondenspannung Nach-KAT-Sonde 2",
  0xA0: "MTC-Lageregler PI-Summenpruefung",
  0xA1: "MTC-Lageregler PI-Summenpruefung",
  0xA2: "MTC-Lageregler Regeldifferenz",
  0xA8: "Thermostat klemmt offen",
  0xBA: "LS1-Betriebsbereitschaft waehrend aktivem LR",
  0xBB: "LS2-Betriebsbereitschaft waehrend aktivem LR",
  0xBC: "Lambdasondenheizung Vor-KAT-Sonde 1",
  0xBD: "Lambdasondenheizung Vor-KAT-Sonde 2",
  0xBE: "Lambdasondenheizung Nach-KAT-Sonde 1",
  0xBF: "Lambdasondenheizung Nach-KAT-Sonde 2",
  0xC4: "Fehler Variante Drucksensor erkennen",
  0xC5: "Umgebungsdrucksensor",
  0xC6: "Kat-Wirkungsgrad bei Anspringzeit Bk1",
  0xC7: "Kat-Wirkungsgrad bei Anspringzeit Bk2",
  0xCA: "Lambdaregelgrenze Bank1",
  0xCB: "Lambdaregelgrenze Bank2",
  0xCC: "Leerlaufdrehzahl",
  0xD1: "EWS-Code",
  0xD2: "ZSR Fehler (>2 Zyl.)",
  0xD3: "LLFS Fehler in der Mechanik",
  0xD6: "Tachosignal unplausibel",
  0xD7: "Nach-Kat-Sonde, Aktivitaetsueberpruefung BK1 (Sonde 3)",
  0xD8: "Nach-Kat-Sonde, Aktivitaetsueberpruefung BK2 (Sonde 4)",
  0xD9: "Timeout CAN-Botschaft EGS1",
  0xDB: "CAN bus_off",
  0xDC: "NKAT-Sondenspannung, Sonde zu langsam BK1",
  0xDD: "NKAT-Sondenspannung, Sonde zu langsam BK2",
  0xDE: "Lambdaregelung nach vorgegebener Zeit nicht aktiv",
  0xDF: "Sprungzeit NKAT-Sonde BK1",
  0xE0: "Sprungzeit NKAT-Sonde BK2",
  0xE1: "Sprungzeit NKAT-Sonde BK2",
  0xE2: "Lambdatrimmregelung Nach-Kat-Bank 2",
  0xE3: "Lambdareglerabweichung Bank 1",
  0xE4: "Lambdareglerabweichung Bank 2",
  0xE5: "Regelfrequenz Lambdasonde Bank 1",
  0xE6: "Regelfrequenz Lambdasonde Bank 2",
  0xE7: "Sprungzeit Lambdasonde Bank 1",
  0xE8: "Sprungzeit Lambdasonde Bank 2",
  0xE9: "Katalysatorwirkungsgrad Hauptkatalysator Bank 1",
  0xEA: "Katalysatorwirkungsgrad Hauptkatalysator Bank 2",
  0xEB: "Lambdatrimmregelung Vor-Kat-Bank 1",
  0xEC: "Lambdatrimmregelung Vor-Kat-Bank 2",
  0xEE: "Verbrennungsaussetzer Zylinder 1",
  0xEF: "Verbrennungsaussetzer Zylinder 2",
  0xF0: "Verbrennungsaussetzer Zylinder 3",
  0xF1: "Verbrennungsaussetzer Zylinder 4",
  0xF2: "Verbrennungsaussetzer Zylinder 5",
  0xF3: "Verbrennungsaussetzer Zylinder 6",
  0xF4: "Segmentzeitmessung fehlerhaft",
  0xF5: "Sekundaerluftsystem Bank 1",
  0xF6: "Sekundaerluftsystem Bank 2",
  0xF7: "Sekundaerluftventil",
  0xF8: "NKAT-Sonde, Sondesignal nach SA unplausibel BK1",
  0xF9: "NKAT-Sonde, Sondesignal nach SA unplausibel BK2",
  0xFA: "Functional Check TEV",
};

// ─── Fault Type Table (FARTTEXTE) ─────────────────────────────────
// ART code → German description text
// Source: MS430DS0.prg table FARTTEXTE, 144 entries

export const FAULT_TYPES: Record<number, string> = {
  0x01: "Fehler ist nicht abgasrelevant",
  0x02: "Fehler momentan nicht vorhanden",
  0x03: "Fehler nicht abgasrelevant",
  0x04: "Fehler nicht entprellt",
  0x05: "statischer Fehler",
  0x06: "Abweichung fett",
  0x07: "Abweichung mager",
  0x08: "Adapt.wert ausserhalb Toleranz",
  0x09: "Adaptionsbedingungen verletzt",
  0x0A: "Applikationsdaten pruefen",
  0x0B: "BLS defekt oder BTS klemmt aktiv",
  0x0C: "BTS defekt",
  0x0D: "CAN bus_off",
  0x0E: "EWS-Code unplausibel",
  0x0F: "FUS aktiv bei Fehlereintrag",
  0x10: "Federtest und LIH-Check nicht bestanden",
  0x11: "Federtest/LIH-check nicht bestanden",
  0x12: "Fehler Sekundaerluftmassenmesser",
  0x13: "Fehler abgasrelevant",
  0x14: "Fehler entprellt",
  0x15: "Fehler ist abgasrelevant",
  0x16: "Fehler momentan vorhanden",
  0x17: "Fettspannung nicht erreicht",
  0x18: "Functional Check TEV n.i.O.",
  0x19: "Funkenbrenndauer zu klein",
  0x1A: "Gemischgrenze fett",
  0x1B: "Gemischgrenze mager",
  0x1C: "Geraeuschwert zu gering",
  0x1D: "Grobleck",
  0x1E: "Hauptrelais nicht in Ordnung",
  0x1F: "Im Fettbereich zu gross",
  0x20: "Im Magerbereich zu gross",
  0x21: "KS Signalleitung -->UBatt",
  0x22: "KS gegen UB",
  0x23: "KS nach Masse oder LB",
  0x24: "KS--> Masse",
  0x25: "KS--> Masse o. Unterb.",
  0x26: "KS--> Masse o. Unterbr.",
  0x27: "KS--> Masse o. Unterbrechung",
  0x28: "KS--> UB",
  0x29: "KS--> UB o. Unterbr.",
  0x2A: "KS--> UBatt",
  0x2B: "KS--> UBatt o. Unterbr.",
  0x2C: "KS--> VB",
  0x2D: "KS-->Masse",
  0x2E: "KS-->Masse o. Leitungsbruch",
  0x2F: "KS-->VB",
  0x30: "KS-->VB oder LB",
  0x31: "KS-->VB oder Leitungsbruch",
  0x32: "KS-->VB/Masse o. Leitungsbruch",
  0x33: "KW - Adaption am Anschlag",
  0x34: "KW - Zahnfehler",
  0x35: "Kat-Wirkungsgrad bei Anspringzeit",
  0x36: "Katalysatorwirkungsgrad zu klein",
  0x37: "Kleinstleck",
  0x38: "Kupplungsschalter defekt",
  0x39: "LL-Drehzahl Abweichung",
  0x3A: "LLFS klemmt geschlossen",
  0x3B: "LLFS klemmt offen",
  0x3C: "MTC-Endstufe",
  0x3D: "Magerspannung nicht erreicht",
  0x3E: "Max-Fehler",
  0x3F: "Min-Fehler",
  0x40: "Misfire CARB_A",
  0x41: "Misfire CARB_B1",
  0x42: "Misfire CARB_B4",
  0x43: "Momentenueberwachung, Regelgrenze ueberschritten",
  0x44: "Motormoment unplausibel zu Fahrerwunsch",
  0x45: "Neuadaption erforderlich",
  0x46: "PVS-Doppelfehler",
  0x47: "PVS-Spannung unplausibel",
  0x48: "Plausibilitaetsfehler",
  0x49: "Plausibilitaetsfehler LM / MDK_IST",
  0x4A: "Regeldifferenzpruefung",
  0x4B: "SA-Durchsatz zu gering",
  0x4C: "SA-Durchsatz zu gross",
  0x4D: "SAV oder SA-Schlauch blockiert",
  0x4E: "SL-Durchsatz zu gering",
  0x4F: "SLV klemmt offen",
  0x50: "Sekundaerluftpumpe nicht aktiv",
  0x51: "Sekundaerluftventil klemmt offen",
  0x52: "Signal nicht plausibel",
  0x53: "Signal unplausibel",
  0x54: "Signale nicht plausibel",
  0x55: "Sonde nicht mehr betriebswarm",
  0x56: "Sonde zu langsam",
  0x57: "Sondenheizung defekt",
  0x58: "Sondensignal nach SA unplausibel",
  0x59: "Spannungsregler PVS-Potis fehlerhaft",
  0x5A: "Spg.-Werte bei LIH-Adaption nicht zul.",
  0x5B: "Spg.-Werte bei UMA-Adaption nicht zul.",
  0x5C: "Sprungzeit zu gross",
  0x5D: "Startwert nicht akzeptiert",
  0x5E: "Steuergeraet defekt",
  0x5F: "TCO unplausibel",
  0x60: "TKW_MAX-Plausibilitaet",
  0x61: "TPS-Poti 1 unplausibel zur Luftmasse",
  0x62: "TPS-Poti 2 unplausibel zur Luftmasse",
  0x63: "Tastverhaeltnis < 1s ueberschritten",
  0x64: "Tastverhaeltnis > 1s ueberschritten",
  0x65: "Thermostat klemmt offen",
  0x66: "Timeout abgelaufen",
  0x67: "Timeoutzeit erreicht",
  0x68: "Toggle-Bit-Periode falsch",
  0x69: "Unterbr. Masseleitung",
  0x6A: "Unterbrechung",
  0x6B: "Unterbrechung Messwiderstand",
  0x6C: "VANOS blockiert/schwergaengig",
  0x6D: "Wipptaster defekt",
  0x6E: "ZSR Fehler (>2 Zyl.)",
  0x6F: "im Fettbereich zu gross",
  0x70: "im Mager- u. Fettbereich zu gross",
  0x71: "im Magerbereich zu gross",
  0x72: "kein Signal",
  0x73: "kein Zuendfunke",
  0x74: "sporadischer Fehler",
  0x75: "von fett nach mager zu gross",
  0x76: "von mager nach fett zu gross",
  0x77: "zu gross",
  0x78: "Uebertragung-/Parity-Fehler",
  0x79: "Zufallszahl hat nicht weitergeschaltet",
  0x7A: "gleichzeitige Betaetigung Gas + Bremse",
  0x7B: "Signalfehler",
  0x7C: "Startwert nicht akzeptiert/Zufallszahl nicht geaendert",
  0x7D: "SSG-Eingriff unplausibel",
  0x7E: "SSG-Moment unplausibel",
  0x7F: "Timeout Message Counter",
  0x80: "Wert im Bootbereich unplausibel",
  0x81: "Fehlerwert im Bootbereich abgelegt",
  0x82: "Lernen fehlgeschlagen",
  0x83: "CARB-Fehler",
  0x84: "Hauptrelais schaltet nicht / verzoegert",
  0x85: "Motortemperatursensor konstant",
  0x86: "Kuehlerauslasstemperatursensorsignal zu hoch nach Start",
  0x87: "Kuehlerauslasstemperatursensorsignal unplausibel",
  0x88: "Ansauglufttemperatursensorsignal unplausibel",
  0x89: "Abstellzeit unplausibel",
  0x8A: "Abstellzeit ueber CAN-Bus unplausibel",
  0x8B: "Tankfuellstand ueber CAN-Bus unplausibel",
  0x8C: "Tankfuellstand unplausibel",
  0x8D: "Umgebungstemperatur ueber CAN-Bus unplausibel",
  0x8E: "Umgebungstemperatur unplausibel",
};

// ─── Fault Environment Conditions (FUMWELTTEXTE) ──────────────────
// UW code → { text, unit, factorA, factorB }
// Physical value = raw * factorA + factorB

export const FAULT_ENV_CONDITIONS: Record<number, { text: string; unit: string; factorA: number; factorB: number }> = {
  0x01: { text: "CAM_AV_EX", unit: "Grad CRK", factorA: 0.8456, factorB: -60 },
  0x02: { text: "CAM_AV_EX_RAW", unit: "Grad CRK", factorA: 0.8456, factorB: -60 },
  0x03: { text: "CAM_AV_IN", unit: "Grad CRK", factorA: 0.8456, factorB: 60 },
  0x04: { text: "CAM_AV_IN_RAW", unit: "Grad CRK", factorA: 0.8456, factorB: 60 },
  0x05: { text: "CAM_REF_EX", unit: "Grad CRK", factorA: 0.8456, factorB: -60 },
  0x06: { text: "CAM_REF_IN", unit: "Grad CRK", factorA: 0.8456, factorB: 60 },
  0x07: { text: "CAM_SP_EX", unit: "Grad CRK", factorA: 0.8456, factorB: -60 },
  0x08: { text: "CAM_SP_IN", unit: "Grad CRK", factorA: 0.8456, factorB: 60 },
  0x09: { text: "CAT_DIAG_1", unit: "-", factorA: 1.0039, factorB: 0 },
  0x0A: { text: "CAT_DIAG_2", unit: "-", factorA: 1.0039, factorB: 0 },
  0x0B: { text: "CPPWM", unit: "%", factorA: 0.3906, factorB: 0 },
  0x10: { text: "ERR_CODE_MU_MU", unit: "dez", factorA: 1, factorB: 0 },
  0x11: { text: "ERR_COD_1_MC_MU", unit: "dez", factorA: 1, factorB: 0 },
  0x14: { text: "ISAPWM", unit: "%", factorA: 0.3921, factorB: 0 },
  0x15: { text: "KNK_PWM", unit: "-", factorA: 0.0039, factorB: 0 },
  0x16: { text: "LAM_1", unit: "%", factorA: 0.3906, factorB: -50 },
  0x17: { text: "LAM_2", unit: "%", factorA: 0.3906, factorB: -50 },
  0x1C: { text: "MAF", unit: "mg/stk", factorA: 5.44706, factorB: 0 },
  0x21: { text: "Motorbetriebszustand", unit: "-", factorA: 1, factorB: 0 },
  0x22: { text: "NL_2", unit: "V", factorA: 0.020, factorB: 0 },
  0x23: { text: "NL_5", unit: "V", factorA: 0.020, factorB: 0 },
  0x24: { text: "N_32", unit: "rpm", factorA: 32, factorB: 0 },
  0x28: { text: "PVS_AV", unit: "Grad TPS", factorA: 0.4686, factorB: 0 },
  0x35: { text: "TAM", unit: "Grad C", factorA: 1, factorB: 0 },
  0x36: { text: "TCO", unit: "Grad C", factorA: 0.75, factorB: -48 },
  0x37: { text: "TCO (Fehlerwert)", unit: "Grad C", factorA: 0.7471, factorB: -48 },
  0x3C: { text: "THR", unit: "Grad TPS", factorA: 0.782, factorB: 0 },
  0x3D: { text: "TIA", unit: "Grad C", factorA: 0.7471, factorB: -48 },
  0x40: { text: "TOIL", unit: "Grad C", factorA: 0.796, factorB: -48 },
  0x47: { text: "TQI_LIM_MAX", unit: "Nm", factorA: 4.0118, factorB: 0 },
  0x48: { text: "TQI_TPS_AV_COR", unit: "Nm", factorA: 4.0118, factorB: 0 },
  0x4E: { text: "VB", unit: "V", factorA: 0.1020, factorB: 0 },
  0x5B: { text: "VLS_UP_1", unit: "V", factorA: 0.005, factorB: 0 },
  0x5C: { text: "VLS_UP_2", unit: "V", factorA: 0.005, factorB: 0 },
  0x5D: { text: "VMAF", unit: "V", factorA: 0.0196, factorB: 0 },
  0x5E: { text: "VS", unit: "km/h", factorA: 1, factorB: 0 },
  0x6C: { text: "V_IGK", unit: "V", factorA: 0.1020, factorB: 0 },
};

// ─── Fault Location → Environment Condition ID mapping ────────────
// From FORTTEXTE UW_1..UW_4 columns: which env conditions are stored per fault
// Key = ORT code, Value = [UW_1, UW_2, UW_3, UW_4] condition IDs

export const FAULT_ENV_MAP: Record<number, [number, number, number, number]> = {
  0x01: [0x24, 0x1C, 0x62, 0x63],
  0x02: [0x24, 0x1C, 0x66, 0x67],
  0x03: [0x24, 0x1C, 0x6A, 0x6B],
  0x05: [0x24, 0x1C, 0x4E, 0x16],
  0x06: [0x24, 0x1C, 0x4E, 0x16],
  0x08: [0x24, 0x3C, 0x8D, 0x5D],
  0x0A: [0x24, 0x1C, 0x3D, 0x37],
  0x0B: [0x24, 0x1C, 0x3D, 0x39],
  0x0C: [0x3D, 0x36, 0x3A, 0x3B],
  0x0E: [0x24, 0x1C, 0x36, 0x3E],
  0x12: [0x24, 0x21, 0x40, 0x4E],
  0x13: [0x4E, 0x21, 0x40, 0x3D],
  0x15: [0x4E, 0x21, 0x40, 0x3D],
  0x16: [0x24, 0x1C, 0x4E, 0x16],
  0x17: [0x24, 0x1C, 0x4E, 0x17],
  0x18: [0x24, 0x1C, 0x4E, 0x17],
  0x19: [0x24, 0x1C, 0x5B, 0x4E],
  0x1D: [0x24, 0x1C, 0x60, 0x61],
  0x1E: [0x24, 0x1C, 0x64, 0x65],
  0x1F: [0x24, 0x1C, 0x68, 0x69],
  0x21: [0x24, 0x1C, 0x4E, 0x17],
  0x23: [0x24, 0x36, 0x3D, 0x4E],
  0x34: [0x24, 0x1C, 0x36, 0x4E],
  0x37: [0x24, 0x1C, 0x5C, 0x4E],
  0x39: [0x24, 0x1C, 0x15, 0x23],
  0x3B: [0x24, 0x1C, 0x15, 0x22],
  0x3D: [0x24, 0x1C, 0x55, 0x4E],
  0x44: [0x24, 0x1C, 0x36, 0x4E],
  0x45: [0x24, 0x36, 0x3D, 0x4E],
  0x4F: [0x24, 0x1C, 0x55, 0x4E],
  0x53: [0x24, 0x21, 0x40, 0x4E],
};

// ─── Decoded Fault Entry ──────────────────────────────────────────

export interface DecodedFault {
  /** Fault location code (ORT) */
  locationCode: number;
  /** Fault location description (German, from SGBD) */
  locationText: string;
  /** Fault type code (ART) */
  typeCode: number;
  /** Fault type description (German, from SGBD) */
  typeText: string;
  /** 4 environment condition raw values */
  envRaw: [number, number, number, number];
  /** 4 decoded environment conditions */
  envDecoded: Array<{
    name: string;
    value: string;
    unit: string;
    raw: number;
  }>;
}

export interface DecodedFaultMemory {
  /** Number of faults stored */
  faultCount: number;
  /** ECU operating hours (from response) */
  operatingHours: number;
  /** Individual decoded faults */
  faults: DecodedFault[];
  /** True if response was successfully parsed */
  valid: boolean;
}

// ─── Decoder Functions ────────────────────────────────────────────

/**
 * Decode environment condition raw value to physical value.
 */
function decodeEnvValue(conditionId: number, rawValue: number): { name: string; value: string; unit: string } {
  const cond = FAULT_ENV_CONDITIONS[conditionId];
  if (!cond) {
    return {
      name: `UW 0x${conditionId.toString(16).padStart(2, "0")}`,
      value: `0x${rawValue.toString(16).padStart(2, "0")} (${rawValue})`,
      unit: "",
    };
  }
  const physical = rawValue * cond.factorA + cond.factorB;
  return {
    name: cond.text,
    value: Number.isInteger(physical) ? String(physical) : physical.toFixed(2),
    unit: cond.unit,
  };
}

/**
 * Decode a DS2 fault memory response payload.
 *
 * Payload format (after addr/len/ack, before checksum):
 *   [fault_count] [op_hours_hi] [op_hours_lo]
 *   For each fault: [ORT] [ART] [UW1] [UW2] [UW3] [UW4]
 *
 * @param payload Response payload bytes (without addr/len/ack/checksum)
 * @returns Decoded fault memory structure
 */
export function decodeFaultMemory(payload: Uint8Array): DecodedFaultMemory {
  if (payload.length < 3) {
    return { faultCount: 0, operatingHours: 0, faults: [], valid: false };
  }

  const faultCount = payload[0];
  const operatingHours = (payload[1] << 8) | payload[2];
  const faults: DecodedFault[] = [];

  // Each fault entry = 6 bytes starting at offset 3
  const FAULT_ENTRY_SIZE = 6;
  const dataStart = 3;
  const availableBytes = payload.length - dataStart;
  const parsableFaults = Math.min(faultCount, Math.floor(availableBytes / FAULT_ENTRY_SIZE));

  for (let i = 0; i < parsableFaults; i++) {
    const offset = dataStart + i * FAULT_ENTRY_SIZE;
    const ort = payload[offset];
    const art = payload[offset + 1];
    const uw1 = payload[offset + 2];
    const uw2 = payload[offset + 3];
    const uw3 = payload[offset + 4];
    const uw4 = payload[offset + 5];

    const locationText = FAULT_LOCATIONS[ort] ?? `Unbekannter Fehlerort 0x${ort.toString(16).padStart(2, "0")}`;
    const typeText = FAULT_TYPES[art] ?? `Unbekannte Fehlerart 0x${art.toString(16).padStart(2, "0")}`;

    // Look up environment condition IDs for this fault location
    const envMap = FAULT_ENV_MAP[ort] ?? [0, 0, 0, 0];
    const envRaw: [number, number, number, number] = [uw1, uw2, uw3, uw4];

    const envDecoded = envMap.map((condId, idx) => {
      if (condId === 0) {
        return { name: "---", value: String(envRaw[idx]), unit: "", raw: envRaw[idx] };
      }
      const decoded = decodeEnvValue(condId, envRaw[idx]);
      return { ...decoded, raw: envRaw[idx] };
    });

    faults.push({
      locationCode: ort,
      locationText,
      typeCode: art,
      typeText,
      envRaw,
      envDecoded,
    });
  }

  return {
    faultCount,
    operatingHours,
    faults,
    valid: true,
  };
}

/**
 * Format a decoded fault memory into human-readable fields for the TUI.
 */
export function formatFaultMemory(fm: DecodedFaultMemory): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];

  fields.push({ label: "Fault Count", value: String(fm.faultCount) });
  fields.push({ label: "Operating Hours", value: `${fm.operatingHours} h` });

  if (fm.faults.length === 0 && fm.faultCount === 0) {
    fields.push({ label: "Status", value: "No faults stored" });
    return fields;
  }

  for (let i = 0; i < fm.faults.length; i++) {
    const f = fm.faults[i];
    fields.push({ label: "", value: "" }); // separator
    fields.push({
      label: `Fault #${i + 1} Location`,
      value: `0x${f.locationCode.toString(16).padStart(2, "0")} ${f.locationText}`,
    });
    fields.push({
      label: `Fault #${i + 1} Type`,
      value: `0x${f.typeCode.toString(16).padStart(2, "0")} ${f.typeText}`,
    });

    for (const env of f.envDecoded) {
      if (env.name === "---") continue;
      fields.push({
        label: `  ${env.name}`,
        value: `${env.value} ${env.unit}`.trim(),
      });
    }
  }

  return fields;
}
