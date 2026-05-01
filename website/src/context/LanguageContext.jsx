import { createContext, useContext, useState } from 'react'

const strings = {
  en: {
    nav: {
      features: 'Features',
      product: 'Product',
      pricing: 'Pricing',
      about: 'About',
      signIn: 'Sign in',
      getStarted: 'Get started free',
      aboutItems: { aboutUs: 'About us', blog: 'Blog', faq: 'FAQ', documentation: 'Documentation', status: 'Status' },
    },
    hero: {
      eyebrow: 'The all-in-one harbor management platform',
      title1: 'Run your', titleEm: 'whole harbor.', title2: 'One platform.',
      sub: 'From berth assignments to boatyard cranes, billing to eSign — DocksBase gives harbor masters and marina operators every operational tool in one cloud-based system.',
      cta1: 'Start free — no card needed', cta2: 'See all 14 modules',
    },
    trust: 'Trusted by 200+ marinas worldwide',
    features: {
      eyebrow: 'The full platform', title: '14 modules. One platform.',
      sub: 'Every tool a harbor needs — built in, not bolted on.',
      allModules: '14 modules included',
      allModulesSub: '— Operations · Yard & Crew · Finance · People · Hospitality',
    },
    product: {
      eyebrow: 'Live Platform', title: 'Built for the dock. Ready on day one.',
      sub: 'No training weeks. No consultants. Onboard your harbor in under 4 hours and have your full operation visible from one screen — berths, arrivals, payments, and alerts, all live.',
      demo: 'Try the live demo',
    },
    pricing: {
      eyebrow: 'Pricing', title: 'Simple pricing for every harbor.',
      sub: 'Start free. Scale as you grow. No surprise fees.',
      note: 'All plans include a 14-day free trial. No credit card required.',
    },
    cta: {
      title1: 'Ready to modernize', titleEm: 'your harbor?',
      sub: 'Start free. Get your berths, bookings, and billing running in one afternoon. Upgrade anytime as your operation grows.',
      btn1: 'Get DocksBase free →', btn2: 'Book a demo',
      note: 'Free for up to 50 berths. Then from €49/month. Cancel anytime.',
    },
    whiteLabel: {
      eyebrow: 'White-label portal',
      title: 'Your name on the door. Our engine in the back.',
      body: "Give boaters a seamless online experience under your own domain — no DocksBase branding, no third-party redirects. One DNS record is all it takes: your booking portal goes live at reservations.yourmarina.com and boaters never know we exist.",
      checklist: [
        'Custom subdomain — reservations.yourmarina.com',
        'Your logo, colours & marina name throughout',
        'Online bookings, berthing requests & payments',
        'Boaters never see the DocksBase name',
        'We build or refresh your full marina website too',
      ],
      cta: 'Request white-label setup',
      flowSteps: [
        'Boater visits reservations.yourmarina.com',
        'DocksBase serves your branded portal',
        'Berth reserved — your marina gets the booking',
      ],
      poweredBy: 'Powered by DocksBase',
    },
    featureRequest: {
      eyebrow: 'Shape the product', title: "Didn't find the feature you need?",
      sub: "We're building DocksBase with the people who run harbors. Tell us what's missing — your request goes straight to the team.",
      placeholder: "Describe the feature or workflow you're missing...",
      btn: 'Send request', note: "We read every message. We'll reply within 2 business days.",
      success: "Got it — thank you! We'll be in touch.",
    },
    footer: {
      tagline: 'The complete management platform for modern harbors and marinas.',
      product: 'Product', company: 'Company', support: 'Support',
      copy: '© 2026 DocksBase. All rights reserved.',
      productLinks: ['Features', 'Pricing', 'Changelog', 'Roadmap', 'API Docs'],
      companyLinks: ['About', 'Blog', 'Careers', 'Press', 'Contact'],
      supportLinks: ['Help Center', 'Onboarding', 'Status', 'Security', 'GDPR'],
    },
  },

  de: {
    nav: {
      features: 'Funktionen', product: 'Produkt', pricing: 'Preise', about: 'Über uns',
      signIn: 'Anmelden', getStarted: 'Kostenlos starten',
      aboutItems: { aboutUs: 'Über uns', blog: 'Blog', faq: 'FAQ', documentation: 'Dokumentation', status: 'Status' },
    },
    hero: {
      eyebrow: 'Die All-in-One-Hafenmanagementsoftware',
      title1: 'Ihr', titleEm: 'ganzer Hafen.', title2: 'Eine Plattform.',
      sub: 'Von Liegeplätzen bis zum Bootshaus, von der Abrechnung bis zur digitalen Unterschrift — DocksBase bündelt jedes Betriebswerkzeug in einem cloudbasierten System.',
      cta1: 'Kostenlos starten', cta2: 'Alle 14 Module ansehen',
    },
    trust: 'Vertrauen von über 200 Marinas weltweit',
    features: {
      eyebrow: 'Die vollständige Plattform', title: '14 Module. Eine Plattform.',
      sub: 'Alles, was ein Hafen braucht — integriert, nicht nachträglich ergänzt.',
      allModules: '14 Module inklusive',
      allModulesSub: '— Betrieb · Werft & Personal · Finanzen · Mitglieder · Gastronomie',
    },
    product: {
      eyebrow: 'Live-Plattform', title: 'Für den Hafen gebaut. Vom ersten Tag bereit.',
      sub: 'Keine wochenlange Einarbeitung. Keine Berater. Ihr Hafen läuft in unter 4 Stunden — Liegeplätze, Ankünfte, Zahlungen und Warnmeldungen auf einem Bildschirm.',
      demo: 'Live-Demo starten',
    },
    pricing: {
      eyebrow: 'Preise', title: 'Einfache Preise für jeden Hafen.',
      sub: 'Kostenlos starten. Wachsen ohne Überraschungen.',
      note: 'Alle Pläne beinhalten eine 14-tägige kostenlose Testphase. Keine Kreditkarte erforderlich.',
    },
    cta: {
      title1: 'Bereit, Ihren Hafen zu modernisieren?', titleEm: '',
      sub: 'Starten Sie kostenlos. Richten Sie Liegeplätze, Buchungen und Abrechnung an einem Nachmittag ein. Jederzeit upgraden.',
      btn1: 'DocksBase kostenlos testen →', btn2: 'Demo buchen',
      note: 'Kostenlos bis 50 Liegeplätze. Danach ab €49/Monat. Jederzeit kündbar.',
    },
    whiteLabel: {
      eyebrow: 'White-Label-Portal',
      title: 'Ihr Name nach außen. Unsere Technik dahinter.',
      body: 'Bieten Sie Bootsfahrern ein nahtloses Online-Erlebnis unter Ihrer eigenen Domain — ohne DocksBase-Branding. Ein DNS-Eintrag genügt: Ihr Buchungsportal läuft unter reservierungen.ihrhafen.de, ohne dass Kunden jemals von uns erfahren.',
      checklist: [
        'Eigene Subdomain — reservierungen.ihrhafen.de',
        'Ihr Logo, Ihre Farben & Ihr Hafenname',
        'Online-Buchungen, Liegeplatzanfragen & Zahlungen',
        'Bootsfahrer sehen niemals den Namen DocksBase',
        'Wir bauen oder erneuern Ihre komplette Hafenwebsite',
      ],
      cta: 'White-Label einrichten',
      flowSteps: [
        'Bootsfahrer öffnet reservierungen.ihrhafen.de',
        'DocksBase liefert Ihr gebrandetes Portal',
        'Buchung bestätigt — Ihr Hafen erhält die Reservierung',
      ],
      poweredBy: 'Powered by DocksBase',
    },
    featureRequest: {
      eyebrow: 'Produkt mitgestalten', title: 'Fehlt Ihnen eine Funktion?',
      sub: 'Wir entwickeln DocksBase gemeinsam mit Hafenbetreibern. Teilen Sie uns mit, was fehlt — Ihre Anfrage geht direkt ans Team.',
      placeholder: 'Beschreiben Sie die Funktion oder den Ablauf, der Ihnen fehlt...',
      btn: 'Anfrage senden', note: 'Wir lesen jede Nachricht und antworten innerhalb von 2 Werktagen.',
      success: 'Vielen Dank! Wir melden uns in Kürze.',
    },
    footer: {
      tagline: 'Die vollständige Managementsoftware für moderne Häfen und Marinas.',
      product: 'Produkt', company: 'Unternehmen', support: 'Support',
      copy: '© 2026 DocksBase. Alle Rechte vorbehalten.',
      productLinks: ['Funktionen', 'Preise', 'Changelog', 'Roadmap', 'API-Docs'],
      companyLinks: ['Über uns', 'Blog', 'Karriere', 'Presse', 'Kontakt'],
      supportLinks: ['Hilfecenter', 'Einrichtung', 'Status', 'Sicherheit', 'DSGVO'],
    },
  },

  nl: {
    nav: {
      features: 'Functies', product: 'Product', pricing: 'Prijzen', about: 'Over ons',
      signIn: 'Inloggen', getStarted: 'Gratis starten',
      aboutItems: { aboutUs: 'Over ons', blog: 'Blog', faq: 'FAQ', documentation: 'Documentatie', status: 'Status' },
    },
    hero: {
      eyebrow: 'Het alles-in-één havenbeheersysteem',
      title1: 'Beheer uw', titleEm: 'hele haven.', title2: 'Één platform.',
      sub: 'Van ligplaatsen tot scheepswerf, van facturering tot eSign — DocksBase geeft havenmeester en marinaoperators alle operationele tools in één cloudgebaseerd systeem.',
      cta1: 'Gratis starten — geen kaart nodig', cta2: 'Alle 14 modules bekijken',
    },
    trust: 'Vertrouwd door 200+ marina\'s wereldwijd',
    features: {
      eyebrow: 'Het volledige platform', title: '14 modules. Één platform.',
      sub: 'Alles wat een haven nodig heeft — ingebouwd, niet achteraf toegevoegd.',
      allModules: '14 modules inbegrepen',
      allModulesSub: '— Operaties · Werf & Personeel · Financiën · Leden · Horeca',
    },
    product: {
      eyebrow: 'Live Platform', title: 'Gebouwd voor de steiger. Klaar op dag één.',
      sub: 'Geen weken training. Geen consultants. Uw haven operationeel in minder dan 4 uur — ligplaatsen, aankomsten, betalingen en meldingen op één scherm.',
      demo: 'Probeer de live demo',
    },
    pricing: {
      eyebrow: 'Prijzen', title: 'Eenvoudige prijzen voor elke haven.',
      sub: 'Begin gratis. Groei zonder verrassingen.',
      note: 'Alle abonnementen bevatten een gratis proefperiode van 14 dagen. Geen creditcard vereist.',
    },
    cta: {
      title1: 'Klaar om uw haven', titleEm: 'te moderniseren?',
      sub: 'Begin gratis. Richt ligplaatsen, boekingen en facturering in op één middag. Upgrade wanneer u wilt.',
      btn1: 'DocksBase gratis →', btn2: 'Demo boeken',
      note: 'Gratis tot 50 ligplaatsen. Daarna vanaf €49/maand. Altijd opzegbaar.',
    },
    whiteLabel: {
      eyebrow: 'White-label portal',
      title: 'Uw naam aan de deur. Onze motor achter de schermen.',
      body: 'Bied boteneigenaren een naadloze online ervaring onder uw eigen domein — geen DocksBase-branding, geen omleidingen. Één DNS-record volstaat: uw boekingsportaal is live op reserveringen.uwmarina.nl en bezoekers weten nooit van ons bestaan.',
      checklist: [
        'Eigen subdomein — reserveringen.uwmarina.nl',
        'Uw logo, kleuren & marinanaam door het hele portaal',
        'Online boekingen, ligplaatsverzoeken & betalingen',
        'Bootseigenaren zien nooit de naam DocksBase',
        'Wij bouwen of vernieuwen ook uw volledige marinawebsite',
      ],
      cta: 'White-label instellen',
      flowSteps: [
        'Bootseigenaar bezoekt reserveringen.uwmarina.nl',
        'DocksBase serveert uw branded portaal',
        'Ligplaats gereserveerd — uw marina ontvangt de boeking',
      ],
      poweredBy: 'Powered by DocksBase',
    },
    featureRequest: {
      eyebrow: 'Vorm het product', title: 'Functie niet gevonden?',
      sub: 'We bouwen DocksBase samen met havenbeheerders. Vertel ons wat ontbreekt — uw verzoek gaat direct naar het team.',
      placeholder: 'Beschrijf de functie of workflow die u mist...',
      btn: 'Verzoek sturen', note: 'We lezen elk bericht en reageren binnen 2 werkdagen.',
      success: 'Bedankt! We nemen snel contact op.',
    },
    footer: {
      tagline: 'Het complete beheersplatform voor moderne havens en marina\'s.',
      product: 'Product', company: 'Bedrijf', support: 'Ondersteuning',
      copy: '© 2026 DocksBase. Alle rechten voorbehouden.',
      productLinks: ['Functies', 'Prijzen', 'Changelog', 'Roadmap', 'API-docs'],
      companyLinks: ['Over ons', 'Blog', 'Vacatures', 'Pers', 'Contact'],
      supportLinks: ['Helpcentrum', 'Onboarding', 'Status', 'Beveiliging', 'AVG'],
    },
  },

  it: {
    nav: {
      features: 'Funzionalità', product: 'Prodotto', pricing: 'Prezzi', about: 'Chi siamo',
      signIn: 'Accedi', getStarted: 'Inizia gratis',
      aboutItems: { aboutUs: 'Chi siamo', blog: 'Blog', faq: 'FAQ', documentation: 'Documentazione', status: 'Stato' },
    },
    hero: {
      eyebrow: 'La piattaforma all-in-one per la gestione portuale',
      title1: 'Gestisci il tuo', titleEm: 'intero porto.', title2: 'Un\'unica piattaforma.',
      sub: 'Dalle assegnazioni dei posti barca alle gru del cantiere, dalla fatturazione alla firma digitale — DocksBase offre ai capitani di porto e agli operatori marittimi ogni strumento in un unico sistema cloud.',
      cta1: 'Inizia gratis — nessuna carta', cta2: 'Scopri tutti i 14 moduli',
    },
    trust: 'Scelto da oltre 200 marine nel mondo',
    features: {
      eyebrow: 'La piattaforma completa', title: '14 moduli. Una piattaforma.',
      sub: 'Tutto ciò di cui un porto ha bisogno — integrato, non aggiunto in seguito.',
      allModules: '14 moduli inclusi',
      allModulesSub: '— Operazioni · Cantiere & Personale · Finanza · Clienti · Ospitalità',
    },
    product: {
      eyebrow: 'Piattaforma Live', title: 'Costruito per il molo. Pronto dal primo giorno.',
      sub: 'Nessuna settimana di formazione. Nessun consulente. Porto operativo in meno di 4 ore — posti barca, arrivi, pagamenti e avvisi su un unico schermo.',
      demo: 'Prova la demo live',
    },
    pricing: {
      eyebrow: 'Prezzi', title: 'Prezzi semplici per ogni porto.',
      sub: 'Inizia gratis. Cresci senza sorprese.',
      note: 'Tutti i piani includono una prova gratuita di 14 giorni. Nessuna carta di credito richiesta.',
    },
    cta: {
      title1: 'Pronti a modernizzare', titleEm: 'il vostro porto?',
      sub: 'Inizia gratis. Configura posti barca, prenotazioni e fatturazione in un pomeriggio. Aggiorna quando vuoi.',
      btn1: 'Ottieni DocksBase gratis →', btn2: 'Prenota una demo',
      note: 'Gratis fino a 50 posti barca. Poi da €49/mese. Disdici in qualsiasi momento.',
    },
    whiteLabel: {
      eyebrow: 'Portale white-label',
      title: 'Il vostro nome davanti. Il nostro motore dietro.',
      body: "Offrite ai diportisti un'esperienza online fluida sotto il vostro dominio — nessun branding DocksBase, nessun reindirizzamento. Un solo record DNS basta: il portale di prenotazione va live su prenotazioni.iltuoporto.it e i clienti non sapranno mai di noi.",
      checklist: [
        'Sottodominio personalizzato — prenotazioni.iltuoporto.it',
        'Il vostro logo, colori & nome del porto ovunque',
        'Prenotazioni online, richieste ormeggio & pagamenti',
        'I diportisti non vedono mai il nome DocksBase',
        'Costruiamo o aggiorniamo anche il vostro sito web',
      ],
      cta: 'Richiedi configurazione white-label',
      flowSteps: [
        'Il diportista visita prenotazioni.iltuoporto.it',
        'DocksBase serve il vostro portale brandizzato',
        'Ormeggio prenotato — il porto riceve la prenotazione',
      ],
      poweredBy: 'Powered by DocksBase',
    },
    featureRequest: {
      eyebrow: 'Contribuisci al prodotto', title: 'Non hai trovato la funzione che cerchi?',
      sub: 'Stiamo costruendo DocksBase insieme a chi gestisce i porti. Dicci cosa manca — la tua richiesta arriva direttamente al team.',
      placeholder: 'Descrivi la funzione o il flusso di lavoro che ti manca...',
      btn: 'Invia richiesta', note: 'Leggiamo ogni messaggio e rispondiamo entro 2 giorni lavorativi.',
      success: 'Ricevuto — grazie! Ti contatteremo presto.',
    },
    footer: {
      tagline: 'La piattaforma di gestione completa per porti e marine moderne.',
      product: 'Prodotto', company: 'Azienda', support: 'Supporto',
      copy: '© 2026 DocksBase. Tutti i diritti riservati.',
      productLinks: ['Funzionalità', 'Prezzi', 'Changelog', 'Roadmap', 'API Docs'],
      companyLinks: ['Chi siamo', 'Blog', 'Lavora con noi', 'Stampa', 'Contatti'],
      supportLinks: ['Centro assistenza', 'Onboarding', 'Stato', 'Sicurezza', 'GDPR'],
    },
  },

  es: {
    nav: {
      features: 'Funciones', product: 'Producto', pricing: 'Precios', about: 'Nosotros',
      signIn: 'Iniciar sesión', getStarted: 'Empezar gratis',
      aboutItems: { aboutUs: 'Quiénes somos', blog: 'Blog', faq: 'FAQ', documentation: 'Documentación', status: 'Estado' },
    },
    hero: {
      eyebrow: 'La plataforma todo en uno para gestión portuaria',
      title1: 'Gestiona', titleEm: 'todo tu puerto.', title2: 'Una plataforma.',
      sub: 'Desde la asignación de amarres hasta las grúas del astillero, la facturación y la firma digital — DocksBase ofrece a los capitanes de puerto y operadores marítimos todas las herramientas en un sistema en la nube.',
      cta1: 'Empezar gratis — sin tarjeta', cta2: 'Ver los 14 módulos',
    },
    trust: 'La confianza de más de 200 marinas en todo el mundo',
    features: {
      eyebrow: 'La plataforma completa', title: '14 módulos. Una plataforma.',
      sub: 'Todo lo que necesita un puerto — integrado, no añadido a posteriori.',
      allModules: '14 módulos incluidos',
      allModulesSub: '— Operaciones · Astillero & Personal · Finanzas · Socios · Hostelería',
    },
    product: {
      eyebrow: 'Plataforma en vivo', title: 'Construido para el muelle. Listo desde el primer día.',
      sub: 'Sin semanas de formación. Sin consultores. Puerto en funcionamiento en menos de 4 horas — amarres, llegadas, pagos y alertas en una sola pantalla.',
      demo: 'Probar la demo en vivo',
    },
    pricing: {
      eyebrow: 'Precios', title: 'Precios sencillos para cada puerto.',
      sub: 'Empieza gratis. Crece sin sorpresas.',
      note: 'Todos los planes incluyen una prueba gratuita de 14 días. No se requiere tarjeta de crédito.',
    },
    cta: {
      title1: '¿Listo para modernizar', titleEm: 'tu puerto?',
      sub: 'Empieza gratis. Configura amarres, reservas y facturación en una tarde. Actualiza cuando quieras.',
      btn1: 'Obtener DocksBase gratis →', btn2: 'Reservar una demo',
      note: 'Gratis hasta 50 amarres. Luego desde €49/mes. Cancela cuando quieras.',
    },
    whiteLabel: {
      eyebrow: 'Portal white-label',
      title: 'Su nombre en la puerta. Nuestro motor detrás.',
      body: 'Ofrezca a los navegantes una experiencia online fluida bajo su propio dominio — sin branding de DocksBase, sin redirecciones. Un solo registro DNS es suficiente: su portal de reservas estará en reservas.supuerto.es y los usuarios nunca sabrán que existimos.',
      checklist: [
        'Subdominio personalizado — reservas.supuerto.es',
        'Su logo, colores & nombre del puerto en todo el portal',
        'Reservas online, solicitudes de amarre & pagos',
        'Los navegantes nunca ven el nombre DocksBase',
        'También diseñamos o renovamos su web completa',
      ],
      cta: 'Solicitar configuración white-label',
      flowSteps: [
        'El navegante visita reservas.supuerto.es',
        'DocksBase sirve su portal con su marca',
        'Amarre reservado — su puerto recibe la reserva',
      ],
      poweredBy: 'Powered by DocksBase',
    },
    featureRequest: {
      eyebrow: 'Da forma al producto', title: '¿No encontraste la función que necesitas?',
      sub: 'Estamos construyendo DocksBase junto a quienes gestionan puertos. Dinos qué falta — tu solicitud llega directamente al equipo.',
      placeholder: 'Describe la función o el flujo de trabajo que te falta...',
      btn: 'Enviar solicitud', note: 'Leemos cada mensaje y respondemos en 2 días hábiles.',
      success: 'Recibido — ¡gracias! Nos pondremos en contacto.',
    },
    footer: {
      tagline: 'La plataforma de gestión completa para puertos deportivos y marinas modernas.',
      product: 'Producto', company: 'Empresa', support: 'Soporte',
      copy: '© 2026 DocksBase. Todos los derechos reservados.',
      productLinks: ['Funciones', 'Precios', 'Changelog', 'Hoja de ruta', 'API Docs'],
      companyLinks: ['Quiénes somos', 'Blog', 'Empleo', 'Prensa', 'Contacto'],
      supportLinks: ['Centro de ayuda', 'Incorporación', 'Estado', 'Seguridad', 'RGPD'],
    },
  },

  fr: {
    nav: {
      features: 'Fonctionnalités', product: 'Produit', pricing: 'Tarifs', about: 'À propos',
      signIn: 'Se connecter', getStarted: 'Démarrer gratuitement',
      aboutItems: { aboutUs: 'À propos de nous', blog: 'Blog', faq: 'FAQ', documentation: 'Documentation', status: 'Statut' },
    },
    hero: {
      eyebrow: 'La plateforme tout-en-un de gestion portuaire',
      title1: 'Gérez', titleEm: 'tout votre port.', title2: 'Une seule plateforme.',
      sub: 'Des attributions de postes aux grues du chantier naval, de la facturation à la signature électronique — DocksBase donne aux capitaines de port et aux opérateurs de marina tous les outils dans un système cloud.',
      cta1: 'Démarrer gratuitement', cta2: 'Voir les 14 modules',
    },
    trust: 'Plus de 200 marinas nous font confiance dans le monde',
    features: {
      eyebrow: 'La plateforme complète', title: '14 modules. Une plateforme.',
      sub: 'Tout ce dont un port a besoin — intégré, pas ajouté après coup.',
      allModules: '14 modules inclus',
      allModulesSub: '— Opérations · Chantier & Équipage · Finance · Membres · Restauration',
    },
    product: {
      eyebrow: 'Plateforme en direct', title: 'Conçu pour le quai. Prêt dès le premier jour.',
      sub: 'Pas de semaines de formation. Pas de consultants. Votre port opérationnel en moins de 4 heures — postes, arrivées, paiements et alertes sur un seul écran.',
      demo: 'Essayer la démo en direct',
    },
    pricing: {
      eyebrow: 'Tarifs', title: 'Des tarifs simples pour chaque port.',
      sub: 'Commencez gratuitement. Grandissez sans surprises.',
      note: 'Tous les forfaits incluent un essai gratuit de 14 jours. Aucune carte de crédit requise.',
    },
    cta: {
      title1: 'Prêt à moderniser', titleEm: 'votre port ?',
      sub: 'Démarrez gratuitement. Configurez vos postes, réservations et facturation en un après-midi. Évoluez à votre rythme.',
      btn1: 'Obtenir DocksBase gratuitement →', btn2: 'Réserver une démo',
      note: 'Gratuit jusqu\'à 50 postes. Ensuite à partir de €49/mois. Résiliez à tout moment.',
    },
    whiteLabel: {
      eyebrow: 'Portail white-label',
      title: 'Votre nom devant. Notre moteur derrière.',
      body: "Offrez aux plaisanciers une expérience en ligne fluide sous votre propre domaine — sans branding DocksBase, sans redirections. Un seul enregistrement DNS suffit : votre portail de réservation est en ligne à reservations.votreport.fr et les visiteurs ne sauront jamais que nous existons.",
      checklist: [
        'Sous-domaine personnalisé — reservations.votreport.fr',
        'Votre logo, couleurs & nom du port partout',
        'Réservations en ligne, demandes de poste & paiements',
        'Les plaisanciers ne voient jamais le nom DocksBase',
        'Nous créons ou modernisons aussi votre site complet',
      ],
      cta: 'Demander la configuration white-label',
      flowSteps: [
        'Le plaisancier visite reservations.votreport.fr',
        'DocksBase sert votre portail à votre image',
        'Poste réservé — votre port reçoit la réservation',
      ],
      poweredBy: 'Powered by DocksBase',
    },
    featureRequest: {
      eyebrow: 'Façonner le produit', title: 'Vous n\'avez pas trouvé la fonctionnalité ?',
      sub: 'Nous construisons DocksBase avec les gestionnaires de ports. Dites-nous ce qui manque — votre demande va directement à l\'équipe.',
      placeholder: 'Décrivez la fonctionnalité ou le flux de travail manquant...',
      btn: 'Envoyer la demande', note: 'Nous lisons chaque message et répondons sous 2 jours ouvrés.',
      success: 'Reçu — merci ! Nous vous recontacterons.',
    },
    footer: {
      tagline: 'La plateforme de gestion complète pour les ports et marinas modernes.',
      product: 'Produit', company: 'Entreprise', support: 'Support',
      copy: '© 2026 DocksBase. Tous droits réservés.',
      productLinks: ['Fonctionnalités', 'Tarifs', 'Changelog', 'Feuille de route', 'API Docs'],
      companyLinks: ['À propos', 'Blog', 'Carrières', 'Presse', 'Contact'],
      supportLinks: ['Centre d\'aide', 'Onboarding', 'Statut', 'Sécurité', 'RGPD'],
    },
  },

  el: {
    nav: {
      features: 'Λειτουργίες', product: 'Προϊόν', pricing: 'Τιμές', about: 'Σχετικά',
      signIn: 'Σύνδεση', getStarted: 'Ξεκινήστε δωρεάν',
      aboutItems: { aboutUs: 'Σχετικά με εμάς', blog: 'Blog', faq: 'FAQ', documentation: 'Τεκμηρίωση', status: 'Κατάσταση' },
    },
    hero: {
      eyebrow: 'Η ολοκληρωμένη πλατφόρμα διαχείρισης λιμένων',
      title1: 'Διαχειριστείτε', titleEm: 'όλο το λιμάνι σας.', title2: 'Μία πλατφόρμα.',
      sub: 'Από εκχώρηση θέσεων έως γερανούς ναυπηγείου, τιμολόγηση και ηλεκτρονικές υπογραφές — το DocksBase προσφέρει σε λιμεναρχεία και χειριστές μαρίνας κάθε εργαλείο σε ένα σύστημα cloud.',
      cta1: 'Ξεκινήστε δωρεάν', cta2: 'Δείτε και τις 14 ενότητες',
    },
    trust: 'Εμπιστοσύνη από 200+ μαρίνες παγκοσμίως',
    features: {
      eyebrow: 'Η πλήρης πλατφόρμα', title: '14 ενότητες. Μία πλατφόρμα.',
      sub: 'Ό,τι χρειάζεται ένα λιμάνι — ενσωματωμένο, όχι προσθαφαιρούμενο.',
      allModules: '14 ενότητες περιλαμβάνονται',
      allModulesSub: '— Λειτουργίες · Ναυπηγείο & Προσωπικό · Οικονομικά · Μέλη · Φιλοξενία',
    },
    product: {
      eyebrow: 'Ζωντανή Πλατφόρμα', title: 'Φτιαγμένο για τον προβλήτα. Έτοιμο από την πρώτη μέρα.',
      sub: 'Χωρίς εβδομάδες εκπαίδευσης. Χωρίς συμβούλους. Το λιμάνι σας σε λειτουργία σε λιγότερο από 4 ώρες — θέσεις, αφίξεις, πληρωμές και ειδοποιήσεις σε μία οθόνη.',
      demo: 'Δοκιμάστε το ζωντανό demo',
    },
    pricing: {
      eyebrow: 'Τιμές', title: 'Απλές τιμές για κάθε λιμάνι.',
      sub: 'Ξεκινήστε δωρεάν. Αναπτυχθείτε χωρίς εκπλήξεις.',
      note: 'Όλα τα πλάνα περιλαμβάνουν δωρεάν δοκιμή 14 ημερών. Δεν απαιτείται πιστωτική κάρτα.',
    },
    cta: {
      title1: 'Έτοιμοι να近代化σετε', titleEm: 'το λιμάνι σας;',
      sub: 'Ξεκινήστε δωρεάν. Ρυθμίστε θέσεις, κρατήσεις και τιμολόγηση σε ένα απόγευμα. Αναβαθμίστε όποτε θέλετε.',
      btn1: 'Αποκτήστε το DocksBase δωρεάν →', btn2: 'Κλείστε demo',
      note: 'Δωρεάν έως 50 θέσεις. Έπειτα από €49/μήνα. Ακύρωση ανά πάσα στιγμή.',
    },
    whiteLabel: {
      eyebrow: 'Πύλη white-label',
      title: 'Το όνομά σας μπροστά. Ο κινητήρας μας πίσω.',
      body: 'Δώστε στους ναυτιλόμενους μια άψογη online εμπειρία κάτω από το δικό σας domain — χωρίς branding DocksBase, χωρίς ανακατευθύνσεις. Αρκεί μία εγγραφή DNS: η πύλη κρατήσεών σας λειτουργεί στο kratiseis.limani-sas.gr και οι επισκέπτες δεν θα μάθουν ποτέ για εμάς.',
      checklist: [
        'Προσαρμοσμένο υποτομέα — kratiseis.limani-sas.gr',
        'Το λογότυπό σας, χρώματα & όνομα λιμανιού παντού',
        'Online κρατήσεις, αιτήματα θέσεων & πληρωμές',
        'Οι ναυτιλόμενοι δεν βλέπουν ποτέ το όνομα DocksBase',
        'Δημιουργούμε ή ανανεώνουμε και την πλήρη ιστοσελίδα σας',
      ],
      cta: 'Αίτηση white-label ρύθμισης',
      flowSteps: [
        'Ο ναυτιλόμενος επισκέπτεται kratiseis.limani-sas.gr',
        'Το DocksBase σερβίρει την επώνυμη πύλη σας',
        'Θέση κρατημένη — το λιμάνι σας λαμβάνει την κράτηση',
      ],
      poweredBy: 'Powered by DocksBase',
    },
    featureRequest: {
      eyebrow: 'Διαμορφώστε το προϊόν', title: 'Δεν βρήκατε τη λειτουργία που χρειάζεστε;',
      sub: 'Χτίζουμε το DocksBase μαζί με όσους διαχειρίζονται λιμάνια. Πείτε μας τι λείπει — το αίτημά σας φτάνει απευθείας στην ομάδα.',
      placeholder: 'Περιγράψτε τη λειτουργία ή τη ροή εργασίας που σας λείπει...',
      btn: 'Αποστολή αιτήματος', note: 'Διαβάζουμε κάθε μήνυμα και απαντάμε εντός 2 εργάσιμων ημερών.',
      success: 'Ελήφθη — ευχαριστούμε! Θα επικοινωνήσουμε σύντομα.',
    },
    footer: {
      tagline: 'Η πλήρης πλατφόρμα διαχείρισης για σύγχρονα λιμάνια και μαρίνες.',
      product: 'Προϊόν', company: 'Εταιρεία', support: 'Υποστήριξη',
      copy: '© 2026 DocksBase. Με επιφύλαξη παντός δικαιώματος.',
      productLinks: ['Λειτουργίες', 'Τιμές', 'Changelog', 'Roadmap', 'API Docs'],
      companyLinks: ['Σχετικά', 'Blog', 'Καριέρα', 'Τύπος', 'Επικοινωνία'],
      supportLinks: ['Κέντρο βοήθειας', 'Onboarding', 'Κατάσταση', 'Ασφάλεια', 'GDPR'],
    },
  },
}

export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'de', label: 'DE', name: 'Deutsch' },
  { code: 'nl', label: 'NL', name: 'Nederlands' },
  { code: 'it', label: 'IT', name: 'Italiano' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'el', label: 'EL', name: 'Ελληνικά' },
]

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState('en')
  const t = strings[lang]
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLang() {
  return useContext(LanguageContext)
}
