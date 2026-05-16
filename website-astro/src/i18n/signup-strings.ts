// website-astro/src/i18n/signup-strings.ts
//
// All translated strings for the multi-step signup flow.
// Mirrors the structure used throughout `src/components/signup/`.
//
// IMPORTANT: do not touch `./strings.ts` — only import from it.

import { LANGUAGES, type LangCode } from './strings'
export { LANGUAGES }
export type { LangCode }

export type PlanKey = 'starter' | 'professional' | 'enterprise'

export interface PlanStrings {
  name: string
  tagline: string
  badge?: string
  features: string[]
}

export interface SignupStrings {
  header: {
    headline: string // "Start your 30-day free trial"
    languageLabel: string // accessible label for the language switcher
  }
  progress: {
    steps: [string, string, string, string] // Plan, Marina, Account, Payment
  }
  plans: Record<PlanKey, PlanStrings>
  stepPlan: {
    title: string
    sub: string
    counterLabel: string // How many marinas?
    counterAddAria: string // Add marina
    counterRemoveAria: string // Remove marina
    // breakdown is composed dynamically: "{base} base + {n} × €{addon} = €{total}/mo {afterTrial}"
    base: string // "€899 base"
    afterTrial: string // "after trial"
    perMonthShort: string // "/mo"
    continue: string
  }
  stepMarina: {
    title: string
    sub: string
    labels: {
      marinaName: string
      address: string
      phone: string
      contactEmail: string
      vatNumber: string
      currency: string
    }
    placeholders: {
      marinaName: string
      address: string
      addressFallback: string
      phone: string
      contactEmail: string
      vatNumber: string
    }
    errors: {
      required: string
      nameTooShort: string
      addressTooShort: string
      phoneInvalid: string
      emailInvalid: string
    }
    back: string
    continue: string
  }
  stepAccount: {
    title: string
    sub: string
    labels: {
      firstName: string
      lastName: string
      email: string
      password: string // "Password * (min. 8 characters)"
    }
    placeholders: {
      firstName: string
      lastName: string
      email: string
    }
    strength: { weak: string; fair: string; good: string; strong: string }
    back: string
    continue: string
    settingUp: string
    planErrorPrefix: string // "Plan error:"
  }
  stepPayment: {
    title: string
    sub: string
    trialBanner: string
    summary: {
      yourMarina: string // fallback when no marina name typed yet
      freeToday: string // "€0 today"
      thenPerMonth: (price: number) => string // "then €X/mo"
      marinasSuffix: (n: number) => string // "× N marinas"
    }
    submit: string
    processing: string
    trust: { noCharge: string; cancel: string; fullAccess: string }
  }
  stepConfirmation: {
    title: string
    body: string
    note: string
  }
}

const en: SignupStrings = {
  header: { headline: 'Start your 30-day free trial', languageLabel: 'Language' },
  progress: { steps: ['Plan', 'Marina', 'Account', 'Payment'] },
  plans: {
    starter: {
      name: 'Starter',
      tagline: 'For small marinas getting started',
      features: ['Up to 100 berths', 'Reservations & berth map', 'Invoicing & billing', 'Boater portal'],
    },
    professional: {
      name: 'Professional',
      tagline: 'For growing marinas',
      badge: 'Most popular',
      features: [
        'Unlimited berths',
        'Everything in Starter',
        'Boatyard & work orders',
        'Staff rota & mobile app',
        'Reports & analytics',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'For large marinas & groups',
      features: [
        'Everything in Professional',
        'Multi-marina management',
        'White-label mobile app',
        'Priority support & SLA',
        'Custom integrations',
      ],
    },
  },
  stepPlan: {
    title: 'Choose your plan',
    sub: 'All plans include a 30-day free trial. Cancel anytime.',
    counterLabel: 'How many marinas?',
    counterAddAria: 'Add marina',
    counterRemoveAria: 'Remove marina',
    base: '€899 base',
    afterTrial: 'after trial',
    perMonthShort: '/mo',
    continue: 'Continue →',
  },
  stepMarina: {
    title: 'Your marina',
    sub: 'Tell us about the marina you manage.',
    labels: {
      marinaName: 'Marina name *',
      address: 'Address *',
      phone: 'Phone *',
      contactEmail: 'Contact email *',
      vatNumber: 'VAT number',
      currency: 'Currency *',
    },
    placeholders: {
      marinaName: 'Harbour View Marina',
      address: 'Start typing your marina address…',
      addressFallback: 'Marina address',
      phone: '+44 1326 312345',
      contactEmail: 'info@yourmarina.com',
      vatNumber: 'GB123456789',
    },
    errors: {
      required: 'Required',
      nameTooShort: 'Name is too short',
      addressTooShort: 'Enter a full address',
      phoneInvalid: 'Enter a valid phone number (e.g. +44 1326 312345)',
      emailInvalid: 'Enter a valid email',
    },
    back: '← Back',
    continue: 'Continue →',
  },
  stepAccount: {
    title: 'Your account',
    sub: 'This will be the owner account for your marina.',
    labels: {
      firstName: 'First name *',
      lastName: 'Last name *',
      email: 'Email address *',
      password: 'Password * (min. 8 characters)',
    },
    placeholders: { firstName: 'David', lastName: 'Smith', email: 'you@yourmarina.com' },
    strength: { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' },
    back: '← Back',
    continue: 'Continue →',
    settingUp: 'Setting up…',
    planErrorPrefix: 'Plan error:',
  },
  stepPayment: {
    title: 'Your first 30 days are free',
    sub: "Add your card to get started — you won't be charged until your trial ends.",
    trialBanner: '30-day free trial · No credit card charge today · Cancel before it ends and pay nothing',
    summary: {
      yourMarina: 'Your marina',
      freeToday: '€0 today',
      thenPerMonth: (p) => `then €${p}/mo`,
      marinasSuffix: (n) => ` × ${n} marinas`,
    },
    submit: 'Start free trial — no charge today →',
    processing: 'Processing…',
    trust: { noCharge: 'No charge today', cancel: 'Cancel anytime', fullAccess: 'Full access from day one' },
  },
  stepConfirmation: {
    title: 'Check your inbox',
    body: "We've sent a verification email to your address. Click the link inside to activate your account and access DocksBase.",
    note: "Didn't get it? Check your spam folder. It may take a minute or two.",
  },
}

const de: SignupStrings = {
  header: { headline: 'Starten Sie Ihre 30-tägige kostenlose Testphase', languageLabel: 'Sprache' },
  progress: { steps: ['Tarif', 'Marina', 'Konto', 'Zahlung'] },
  plans: {
    starter: {
      name: 'Starter',
      tagline: 'Für kleine Marinas am Anfang',
      features: ['Bis zu 100 Liegeplätze', 'Reservierungen & Liegeplatzkarte', 'Rechnungsstellung & Abrechnung', 'Bootsfahrer-Portal'],
    },
    professional: {
      name: 'Professional',
      tagline: 'Für wachsende Marinas',
      badge: 'Beliebteste Wahl',
      features: [
        'Unbegrenzte Liegeplätze',
        'Alles aus Starter',
        'Werft & Arbeitsaufträge',
        'Dienstplan & mobile App',
        'Berichte & Analysen',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'Für große Marinas & Gruppen',
      features: [
        'Alles aus Professional',
        'Multi-Marina-Verwaltung',
        'White-Label mobile App',
        'Priority-Support & SLA',
        'Individuelle Integrationen',
      ],
    },
  },
  stepPlan: {
    title: 'Wählen Sie Ihren Tarif',
    sub: 'Alle Tarife beinhalten eine 30-tägige kostenlose Testphase. Jederzeit kündbar.',
    counterLabel: 'Wie viele Marinas?',
    counterAddAria: 'Marina hinzufügen',
    counterRemoveAria: 'Marina entfernen',
    base: '€899 Grundpreis',
    afterTrial: 'nach der Testphase',
    perMonthShort: '/Monat',
    continue: 'Weiter →',
  },
  stepMarina: {
    title: 'Ihre Marina',
    sub: 'Erzählen Sie uns von der Marina, die Sie verwalten.',
    labels: {
      marinaName: 'Name der Marina *',
      address: 'Adresse *',
      phone: 'Telefon *',
      contactEmail: 'Kontakt-E-Mail *',
      vatNumber: 'USt-IdNr.',
      currency: 'Währung *',
    },
    placeholders: {
      marinaName: 'Harbour View Marina',
      address: 'Geben Sie die Adresse Ihrer Marina ein…',
      addressFallback: 'Adresse der Marina',
      phone: '+44 1326 312345',
      contactEmail: 'info@ihremarina.de',
      vatNumber: 'DE123456789',
    },
    errors: {
      required: 'Pflichtfeld',
      nameTooShort: 'Name ist zu kurz',
      addressTooShort: 'Geben Sie eine vollständige Adresse ein',
      phoneInvalid: 'Geben Sie eine gültige Telefonnummer ein (z. B. +44 1326 312345)',
      emailInvalid: 'Geben Sie eine gültige E-Mail-Adresse ein',
    },
    back: '← Zurück',
    continue: 'Weiter →',
  },
  stepAccount: {
    title: 'Ihr Konto',
    sub: 'Dies wird das Inhaberkonto für Ihre Marina.',
    labels: {
      firstName: 'Vorname *',
      lastName: 'Nachname *',
      email: 'E-Mail-Adresse *',
      password: 'Passwort * (mind. 8 Zeichen)',
    },
    placeholders: { firstName: 'David', lastName: 'Schmidt', email: 'sie@ihremarina.de' },
    strength: { weak: 'Schwach', fair: 'Mittel', good: 'Gut', strong: 'Stark' },
    back: '← Zurück',
    continue: 'Weiter →',
    settingUp: 'Wird eingerichtet…',
    planErrorPrefix: 'Tariffehler:',
  },
  stepPayment: {
    title: 'Ihre ersten 30 Tage sind kostenlos',
    sub: 'Fügen Sie Ihre Karte hinzu, um loszulegen — Sie werden erst nach Ende der Testphase belastet.',
    trialBanner: '30 Tage kostenlos · Heute keine Kartenbelastung · Vor Ende kündigen und nichts bezahlen',
    summary: {
      yourMarina: 'Ihre Marina',
      freeToday: '€0 heute',
      thenPerMonth: (p) => `dann €${p}/Monat`,
      marinasSuffix: (n) => ` × ${n} Marinas`,
    },
    submit: 'Kostenlose Testphase starten — heute keine Belastung →',
    processing: 'Wird verarbeitet…',
    trust: { noCharge: 'Heute keine Belastung', cancel: 'Jederzeit kündbar', fullAccess: 'Voller Zugriff ab Tag eins' },
  },
  stepConfirmation: {
    title: 'Prüfen Sie Ihr Postfach',
    body: 'Wir haben Ihnen eine Bestätigungs-E-Mail gesendet. Klicken Sie auf den Link darin, um Ihr Konto zu aktivieren und auf DocksBase zuzugreifen.',
    note: 'Nicht erhalten? Schauen Sie in Ihren Spam-Ordner. Es kann ein bis zwei Minuten dauern.',
  },
}

const nl: SignupStrings = {
  header: { headline: 'Start uw gratis proefperiode van 30 dagen', languageLabel: 'Taal' },
  progress: { steps: ['Abonnement', 'Marina', 'Account', 'Betaling'] },
  plans: {
    starter: {
      name: 'Starter',
      tagline: "Voor kleine marina's die net beginnen",
      features: ['Tot 100 ligplaatsen', 'Reserveringen & ligplaatskaart', 'Facturatie & betalingen', 'Bootseigenaarportaal'],
    },
    professional: {
      name: 'Professional',
      tagline: "Voor groeiende marina's",
      badge: 'Meest gekozen',
      features: [
        'Onbeperkt ligplaatsen',
        'Alles uit Starter',
        'Werf & werkorders',
        'Personeelsrooster & mobiele app',
        'Rapportages & analyses',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: "Voor grote marina's & groepen",
      features: [
        'Alles uit Professional',
        "Multi-marinabeheer",
        'White-label mobiele app',
        'Priority support & SLA',
        'Maatwerkintegraties',
      ],
    },
  },
  stepPlan: {
    title: 'Kies uw abonnement',
    sub: 'Alle abonnementen bevatten een gratis proefperiode van 30 dagen. Altijd opzegbaar.',
    counterLabel: "Hoeveel marina's?",
    counterAddAria: 'Marina toevoegen',
    counterRemoveAria: 'Marina verwijderen',
    base: '€899 basis',
    afterTrial: 'na de proefperiode',
    perMonthShort: '/mnd',
    continue: 'Verder →',
  },
  stepMarina: {
    title: 'Uw marina',
    sub: 'Vertel ons over de marina die u beheert.',
    labels: {
      marinaName: 'Naam marina *',
      address: 'Adres *',
      phone: 'Telefoon *',
      contactEmail: 'Contact-e-mail *',
      vatNumber: 'BTW-nummer',
      currency: 'Valuta *',
    },
    placeholders: {
      marinaName: 'Harbour View Marina',
      address: 'Begin met typen van het adres van uw marina…',
      addressFallback: 'Adres marina',
      phone: '+44 1326 312345',
      contactEmail: 'info@uwmarina.nl',
      vatNumber: 'NL123456789B01',
    },
    errors: {
      required: 'Verplicht',
      nameTooShort: 'Naam is te kort',
      addressTooShort: 'Voer een volledig adres in',
      phoneInvalid: 'Voer een geldig telefoonnummer in (bijv. +44 1326 312345)',
      emailInvalid: 'Voer een geldig e-mailadres in',
    },
    back: '← Terug',
    continue: 'Verder →',
  },
  stepAccount: {
    title: 'Uw account',
    sub: 'Dit wordt het eigenaarsaccount voor uw marina.',
    labels: {
      firstName: 'Voornaam *',
      lastName: 'Achternaam *',
      email: 'E-mailadres *',
      password: 'Wachtwoord * (min. 8 tekens)',
    },
    placeholders: { firstName: 'David', lastName: 'Jansen', email: 'u@uwmarina.nl' },
    strength: { weak: 'Zwak', fair: 'Redelijk', good: 'Goed', strong: 'Sterk' },
    back: '← Terug',
    continue: 'Verder →',
    settingUp: 'Wordt ingesteld…',
    planErrorPrefix: 'Abonnementfout:',
  },
  stepPayment: {
    title: 'Uw eerste 30 dagen zijn gratis',
    sub: 'Voeg uw kaart toe om te beginnen — er wordt pas afgeschreven na uw proefperiode.',
    trialBanner: '30 dagen gratis · Vandaag geen afschrijving · Zeg op voor het eindigt en betaal niets',
    summary: {
      yourMarina: 'Uw marina',
      freeToday: '€0 vandaag',
      thenPerMonth: (p) => `daarna €${p}/mnd`,
      marinasSuffix: (n) => ` × ${n} marina's`,
    },
    submit: 'Start gratis proefperiode — vandaag geen kosten →',
    processing: 'Bezig met verwerken…',
    trust: { noCharge: 'Vandaag geen kosten', cancel: 'Altijd opzegbaar', fullAccess: 'Volledige toegang vanaf dag één' },
  },
  stepConfirmation: {
    title: 'Controleer uw inbox',
    body: 'We hebben een verificatie-e-mail naar uw adres gestuurd. Klik op de link erin om uw account te activeren en DocksBase te openen.',
    note: 'Niet ontvangen? Controleer uw spamfolder. Het kan een minuut of twee duren.',
  },
}

const it: SignupStrings = {
  header: { headline: 'Inizia la tua prova gratuita di 30 giorni', languageLabel: 'Lingua' },
  progress: { steps: ['Piano', 'Marina', 'Account', 'Pagamento'] },
  plans: {
    starter: {
      name: 'Starter',
      tagline: 'Per piccole marine che iniziano',
      features: ['Fino a 100 posti barca', 'Prenotazioni & mappa posti barca', 'Fatturazione & contabilità', 'Portale diportisti'],
    },
    professional: {
      name: 'Professional',
      tagline: 'Per marine in crescita',
      badge: 'Più popolare',
      features: [
        'Posti barca illimitati',
        'Tutto di Starter',
        'Cantiere & ordini di lavoro',
        'Turni personale & app mobile',
        'Report & analisi',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'Per grandi marine & gruppi',
      features: [
        'Tutto di Professional',
        'Gestione multi-marina',
        'App mobile white-label',
        'Supporto prioritario & SLA',
        'Integrazioni personalizzate',
      ],
    },
  },
  stepPlan: {
    title: 'Scegli il tuo piano',
    sub: 'Tutti i piani includono una prova gratuita di 30 giorni. Disdici quando vuoi.',
    counterLabel: 'Quante marine?',
    counterAddAria: 'Aggiungi marina',
    counterRemoveAria: 'Rimuovi marina',
    base: '€899 base',
    afterTrial: 'dopo la prova',
    perMonthShort: '/mese',
    continue: 'Continua →',
  },
  stepMarina: {
    title: 'La tua marina',
    sub: 'Raccontaci della marina che gestisci.',
    labels: {
      marinaName: 'Nome della marina *',
      address: 'Indirizzo *',
      phone: 'Telefono *',
      contactEmail: 'Email di contatto *',
      vatNumber: 'Partita IVA',
      currency: 'Valuta *',
    },
    placeholders: {
      marinaName: 'Harbour View Marina',
      address: "Inizia a digitare l'indirizzo della marina…",
      addressFallback: 'Indirizzo marina',
      phone: '+44 1326 312345',
      contactEmail: 'info@latuamarina.it',
      vatNumber: 'IT12345678901',
    },
    errors: {
      required: 'Obbligatorio',
      nameTooShort: 'Il nome è troppo corto',
      addressTooShort: 'Inserisci un indirizzo completo',
      phoneInvalid: 'Inserisci un numero di telefono valido (es. +44 1326 312345)',
      emailInvalid: "Inserisci un'email valida",
    },
    back: '← Indietro',
    continue: 'Continua →',
  },
  stepAccount: {
    title: 'Il tuo account',
    sub: "Sarà l'account proprietario della tua marina.",
    labels: {
      firstName: 'Nome *',
      lastName: 'Cognome *',
      email: 'Indirizzo email *',
      password: 'Password * (min. 8 caratteri)',
    },
    placeholders: { firstName: 'David', lastName: 'Rossi', email: 'tu@latuamarina.it' },
    strength: { weak: 'Debole', fair: 'Discreta', good: 'Buona', strong: 'Forte' },
    back: '← Indietro',
    continue: 'Continua →',
    settingUp: 'Configurazione in corso…',
    planErrorPrefix: 'Errore piano:',
  },
  stepPayment: {
    title: 'I tuoi primi 30 giorni sono gratuiti',
    sub: 'Aggiungi la tua carta per iniziare — non sarai addebitato fino al termine della prova.',
    trialBanner: '30 giorni di prova gratuita · Nessun addebito oggi · Disdici prima della fine e non paghi nulla',
    summary: {
      yourMarina: 'La tua marina',
      freeToday: '€0 oggi',
      thenPerMonth: (p) => `poi €${p}/mese`,
      marinasSuffix: (n) => ` × ${n} marine`,
    },
    submit: 'Inizia la prova gratuita — nessun addebito oggi →',
    processing: 'Elaborazione…',
    trust: { noCharge: 'Nessun addebito oggi', cancel: 'Disdici quando vuoi', fullAccess: 'Accesso completo dal primo giorno' },
  },
  stepConfirmation: {
    title: 'Controlla la tua casella di posta',
    body: 'Abbiamo inviato unʼemail di verifica al tuo indirizzo. Clicca sul link al suo interno per attivare il tuo account e accedere a DocksBase.',
    note: 'Non ti è arrivata? Controlla la cartella spam. Possono volerci un paio di minuti.',
  },
}

const es: SignupStrings = {
  header: { headline: 'Comience su prueba gratuita de 30 días', languageLabel: 'Idioma' },
  progress: { steps: ['Plan', 'Marina', 'Cuenta', 'Pago'] },
  plans: {
    starter: {
      name: 'Starter',
      tagline: 'Para marinas pequeñas que empiezan',
      features: ['Hasta 100 amarres', 'Reservas & mapa de amarres', 'Facturación & cobros', 'Portal del navegante'],
    },
    professional: {
      name: 'Professional',
      tagline: 'Para marinas en crecimiento',
      badge: 'Más popular',
      features: [
        'Amarres ilimitados',
        'Todo lo de Starter',
        'Astillero & órdenes de trabajo',
        'Turnos de personal & app móvil',
        'Informes & analítica',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'Para grandes marinas & grupos',
      features: [
        'Todo lo de Professional',
        'Gestión multi-marina',
        'App móvil white-label',
        'Soporte prioritario & SLA',
        'Integraciones a medida',
      ],
    },
  },
  stepPlan: {
    title: 'Elija su plan',
    sub: 'Todos los planes incluyen una prueba gratuita de 30 días. Cancele cuando quiera.',
    counterLabel: '¿Cuántas marinas?',
    counterAddAria: 'Añadir marina',
    counterRemoveAria: 'Quitar marina',
    base: '€899 base',
    afterTrial: 'tras la prueba',
    perMonthShort: '/mes',
    continue: 'Continuar →',
  },
  stepMarina: {
    title: 'Su marina',
    sub: 'Cuéntenos sobre la marina que gestiona.',
    labels: {
      marinaName: 'Nombre de la marina *',
      address: 'Dirección *',
      phone: 'Teléfono *',
      contactEmail: 'Email de contacto *',
      vatNumber: 'CIF / NIF',
      currency: 'Moneda *',
    },
    placeholders: {
      marinaName: 'Harbour View Marina',
      address: 'Empiece a escribir la dirección de su marina…',
      addressFallback: 'Dirección de la marina',
      phone: '+44 1326 312345',
      contactEmail: 'info@sumarina.es',
      vatNumber: 'ESB12345678',
    },
    errors: {
      required: 'Obligatorio',
      nameTooShort: 'El nombre es demasiado corto',
      addressTooShort: 'Introduzca una dirección completa',
      phoneInvalid: 'Introduzca un teléfono válido (p. ej. +44 1326 312345)',
      emailInvalid: 'Introduzca un email válido',
    },
    back: '← Atrás',
    continue: 'Continuar →',
  },
  stepAccount: {
    title: 'Su cuenta',
    sub: 'Esta será la cuenta propietaria de su marina.',
    labels: {
      firstName: 'Nombre *',
      lastName: 'Apellidos *',
      email: 'Dirección de email *',
      password: 'Contraseña * (mín. 8 caracteres)',
    },
    placeholders: { firstName: 'David', lastName: 'García', email: 'tu@sumarina.es' },
    strength: { weak: 'Débil', fair: 'Aceptable', good: 'Buena', strong: 'Fuerte' },
    back: '← Atrás',
    continue: 'Continuar →',
    settingUp: 'Configurando…',
    planErrorPrefix: 'Error de plan:',
  },
  stepPayment: {
    title: 'Sus primeros 30 días son gratis',
    sub: 'Añada su tarjeta para empezar — no se le cobrará hasta que termine la prueba.',
    trialBanner: 'Prueba gratuita de 30 días · Sin cargo hoy · Cancele antes y no pague nada',
    summary: {
      yourMarina: 'Su marina',
      freeToday: '€0 hoy',
      thenPerMonth: (p) => `luego €${p}/mes`,
      marinasSuffix: (n) => ` × ${n} marinas`,
    },
    submit: 'Iniciar prueba gratuita — sin cargo hoy →',
    processing: 'Procesando…',
    trust: { noCharge: 'Sin cargo hoy', cancel: 'Cancele cuando quiera', fullAccess: 'Acceso completo desde el primer día' },
  },
  stepConfirmation: {
    title: 'Revise su bandeja de entrada',
    body: 'Hemos enviado un correo de verificación a su dirección. Haga clic en el enlace para activar su cuenta y acceder a DocksBase.',
    note: '¿No le llega? Revise su carpeta de spam. Puede tardar uno o dos minutos.',
  },
}

const fr: SignupStrings = {
  header: { headline: 'Démarrez votre essai gratuit de 30 jours', languageLabel: 'Langue' },
  progress: { steps: ['Forfait', 'Marina', 'Compte', 'Paiement'] },
  plans: {
    starter: {
      name: 'Starter',
      tagline: 'Pour les petites marinas qui débutent',
      features: ["Jusqu'à 100 postes d'amarrage", "Réservations & plan d'amarrage", 'Facturation & encaissement', 'Portail plaisancier'],
    },
    professional: {
      name: 'Professional',
      tagline: 'Pour les marinas en croissance',
      badge: 'Le plus populaire',
      features: [
        "Postes d'amarrage illimités",
        'Tout ce qui est dans Starter',
        'Chantier & ordres de travail',
        'Planning équipe & app mobile',
        'Rapports & analyses',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'Pour les grandes marinas & groupes',
      features: [
        'Tout ce qui est dans Professional',
        'Gestion multi-marina',
        'App mobile en marque blanche',
        'Support prioritaire & SLA',
        'Intégrations sur mesure',
      ],
    },
  },
  stepPlan: {
    title: 'Choisissez votre forfait',
    sub: 'Tous les forfaits incluent un essai gratuit de 30 jours. Résiliez à tout moment.',
    counterLabel: 'Combien de marinas ?',
    counterAddAria: 'Ajouter une marina',
    counterRemoveAria: 'Retirer une marina',
    base: '€899 de base',
    afterTrial: "après l'essai",
    perMonthShort: '/mois',
    continue: 'Continuer →',
  },
  stepMarina: {
    title: 'Votre marina',
    sub: 'Parlez-nous de la marina que vous gérez.',
    labels: {
      marinaName: 'Nom de la marina *',
      address: 'Adresse *',
      phone: 'Téléphone *',
      contactEmail: 'E-mail de contact *',
      vatNumber: 'Numéro de TVA',
      currency: 'Devise *',
    },
    placeholders: {
      marinaName: 'Harbour View Marina',
      address: "Commencez à saisir l'adresse de votre marina…",
      addressFallback: 'Adresse de la marina',
      phone: '+44 1326 312345',
      contactEmail: 'info@votremarina.fr',
      vatNumber: 'FR12345678901',
    },
    errors: {
      required: 'Obligatoire',
      nameTooShort: 'Le nom est trop court',
      addressTooShort: 'Saisissez une adresse complète',
      phoneInvalid: 'Saisissez un numéro de téléphone valide (p. ex. +44 1326 312345)',
      emailInvalid: 'Saisissez un e-mail valide',
    },
    back: '← Retour',
    continue: 'Continuer →',
  },
  stepAccount: {
    title: 'Votre compte',
    sub: 'Ce sera le compte propriétaire de votre marina.',
    labels: {
      firstName: 'Prénom *',
      lastName: 'Nom *',
      email: 'Adresse e-mail *',
      password: 'Mot de passe * (min. 8 caractères)',
    },
    placeholders: { firstName: 'David', lastName: 'Martin', email: 'vous@votremarina.fr' },
    strength: { weak: 'Faible', fair: 'Moyen', good: 'Bon', strong: 'Fort' },
    back: '← Retour',
    continue: 'Continuer →',
    settingUp: 'Configuration…',
    planErrorPrefix: 'Erreur de forfait :',
  },
  stepPayment: {
    title: 'Vos 30 premiers jours sont gratuits',
    sub: "Ajoutez votre carte pour commencer — vous ne serez débité qu'à la fin de l'essai.",
    trialBanner: "Essai gratuit de 30 jours · Aucun débit aujourd'hui · Résiliez avant la fin et ne payez rien",
    summary: {
      yourMarina: 'Votre marina',
      freeToday: "€0 aujourd'hui",
      thenPerMonth: (p) => `puis €${p}/mois`,
      marinasSuffix: (n) => ` × ${n} marinas`,
    },
    submit: "Démarrer l'essai gratuit — aucun débit aujourd'hui →",
    processing: 'Traitement…',
    trust: { noCharge: "Aucun débit aujourd'hui", cancel: 'Résiliez à tout moment', fullAccess: 'Accès complet dès le premier jour' },
  },
  stepConfirmation: {
    title: 'Consultez votre boîte de réception',
    body: "Nous avons envoyé un e-mail de vérification à votre adresse. Cliquez sur le lien à l'intérieur pour activer votre compte et accéder à DocksBase.",
    note: 'Pas reçu ? Vérifiez votre dossier spam. Cela peut prendre une à deux minutes.',
  },
}

const el: SignupStrings = {
  header: { headline: 'Ξεκινήστε τη δωρεάν δοκιμή σας 30 ημερών', languageLabel: 'Γλώσσα' },
  progress: { steps: ['Πλάνο', 'Μαρίνα', 'Λογαριασμός', 'Πληρωμή'] },
  plans: {
    starter: {
      name: 'Starter',
      tagline: 'Για μικρές μαρίνες που ξεκινούν',
      features: ['Έως 100 θέσεις ελλιμενισμού', 'Κρατήσεις & χάρτης θέσεων', 'Τιμολόγηση & χρεώσεις', 'Πύλη ναυτιλομένων'],
    },
    professional: {
      name: 'Professional',
      tagline: 'Για μαρίνες σε ανάπτυξη',
      badge: 'Πιο δημοφιλές',
      features: [
        'Απεριόριστες θέσεις ελλιμενισμού',
        'Όλα του Starter',
        'Ναυπηγείο & εντολές εργασίας',
        'Πρόγραμμα προσωπικού & κινητή εφαρμογή',
        'Αναφορές & αναλυτικά',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      tagline: 'Για μεγάλες μαρίνες & ομίλους',
      features: [
        'Όλα του Professional',
        'Διαχείριση πολλαπλών μαρινών',
        'Κινητή εφαρμογή white-label',
        'Υποστήριξη προτεραιότητας & SLA',
        'Προσαρμοσμένες ολοκληρώσεις',
      ],
    },
  },
  stepPlan: {
    title: 'Επιλέξτε το πλάνο σας',
    sub: 'Όλα τα πλάνα περιλαμβάνουν δωρεάν δοκιμή 30 ημερών. Ακύρωση ανά πάσα στιγμή.',
    counterLabel: 'Πόσες μαρίνες;',
    counterAddAria: 'Προσθήκη μαρίνας',
    counterRemoveAria: 'Αφαίρεση μαρίνας',
    base: '€899 βασική τιμή',
    afterTrial: 'μετά τη δοκιμή',
    perMonthShort: '/μήνα',
    continue: 'Συνέχεια →',
  },
  stepMarina: {
    title: 'Η μαρίνα σας',
    sub: 'Πείτε μας για τη μαρίνα που διαχειρίζεστε.',
    labels: {
      marinaName: 'Όνομα μαρίνας *',
      address: 'Διεύθυνση *',
      phone: 'Τηλέφωνο *',
      contactEmail: 'Email επικοινωνίας *',
      vatNumber: 'ΑΦΜ',
      currency: 'Νόμισμα *',
    },
    placeholders: {
      marinaName: 'Harbour View Marina',
      address: 'Αρχίστε να πληκτρολογείτε τη διεύθυνση της μαρίνας…',
      addressFallback: 'Διεύθυνση μαρίνας',
      phone: '+44 1326 312345',
      contactEmail: 'info@imarinasas.gr',
      vatNumber: 'EL123456789',
    },
    errors: {
      required: 'Υποχρεωτικό',
      nameTooShort: 'Το όνομα είναι πολύ σύντομο',
      addressTooShort: 'Εισαγάγετε μια πλήρη διεύθυνση',
      phoneInvalid: 'Εισαγάγετε έγκυρο αριθμό τηλεφώνου (π.χ. +44 1326 312345)',
      emailInvalid: 'Εισαγάγετε έγκυρο email',
    },
    back: '← Πίσω',
    continue: 'Συνέχεια →',
  },
  stepAccount: {
    title: 'Ο λογαριασμός σας',
    sub: 'Αυτός θα είναι ο λογαριασμός ιδιοκτήτη της μαρίνας σας.',
    labels: {
      firstName: 'Όνομα *',
      lastName: 'Επώνυμο *',
      email: 'Διεύθυνση email *',
      password: 'Κωδικός * (ελάχ. 8 χαρακτήρες)',
    },
    placeholders: { firstName: 'David', lastName: 'Παπαδόπουλος', email: 'esis@imarinasas.gr' },
    strength: { weak: 'Αδύναμος', fair: 'Μέτριος', good: 'Καλός', strong: 'Ισχυρός' },
    back: '← Πίσω',
    continue: 'Συνέχεια →',
    settingUp: 'Ρύθμιση σε εξέλιξη…',
    planErrorPrefix: 'Σφάλμα πλάνου:',
  },
  stepPayment: {
    title: 'Οι πρώτες 30 ημέρες σας είναι δωρεάν',
    sub: 'Προσθέστε την κάρτα σας για να ξεκινήσετε — δεν θα χρεωθείτε μέχρι να λήξει η δοκιμή.',
    trialBanner: 'Δωρεάν δοκιμή 30 ημερών · Καμία χρέωση κάρτας σήμερα · Ακυρώστε πριν τη λήξη και μην πληρώσετε τίποτα',
    summary: {
      yourMarina: 'Η μαρίνα σας',
      freeToday: '€0 σήμερα',
      thenPerMonth: (p) => `έπειτα €${p}/μήνα`,
      marinasSuffix: (n) => ` × ${n} μαρίνες`,
    },
    submit: 'Έναρξη δωρεάν δοκιμής — καμία χρέωση σήμερα →',
    processing: 'Επεξεργασία…',
    trust: { noCharge: 'Καμία χρέωση σήμερα', cancel: 'Ακύρωση ανά πάσα στιγμή', fullAccess: 'Πλήρης πρόσβαση από την πρώτη μέρα' },
  },
  stepConfirmation: {
    title: 'Ελέγξτε τα εισερχόμενά σας',
    body: 'Στείλαμε ένα email επιβεβαίωσης στη διεύθυνσή σας. Κάντε κλικ στον σύνδεσμο για να ενεργοποιήσετε τον λογαριασμό σας και να αποκτήσετε πρόσβαση στο DocksBase.',
    note: 'Δεν το λάβατε; Ελέγξτε τον φάκελο ανεπιθύμητης αλληλογραφίας. Μπορεί να χρειαστούν ένα-δύο λεπτά.',
  },
}

export const signupStrings: Record<LangCode, SignupStrings> = {
  en, de, nl, it, es, fr, el,
}

export function getSignupStrings(lang: LangCode | string | undefined): SignupStrings {
  if (lang && (lang as LangCode) in signupStrings) {
    return signupStrings[lang as LangCode]
  }
  return signupStrings.en
}
