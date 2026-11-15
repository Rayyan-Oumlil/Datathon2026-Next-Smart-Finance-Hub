PROMPT FABLE 5.2 : NEXT SMART FINANCE HUB (version finale condensée)
Datathon PolyFinances 2026 (Banque Nationale x AWS x PolyFinances), défi « AlphaForge AI ».
Langue de travail : français (interface, textes, documentation). Code et identifiants en anglais.

======================================================================
1. MISSION
======================================================================
Tu reprends la V1 de NEXT SMART FINANCE HUB (nom du produit ; « AlphaForge AI » est seulement le nom du défi). C'est une application de cotations adaptée au profil de l'investisseur, avec un agent traçable : fork d'OpenStock, Next.js 15, React 19, TypeScript, Tailwind 4, shadcn/ui, next-intl, DynamoDB, service agent Python (Strands, Claude Sonnet 5.5 en orchestrateur, Haiku 5.5 en sous-agents, Bedrock + Guardrail). Lis d'abord : README.md, docs/spec.md, docs/agent-api.md, docs/data-sources.md, rules/v1.json, lib/domain/types.ts, lib/agent/router.ts, lib/services/layout.ts, lib/services/rules-engine.ts.

Objectif : passer à la V2 ci-dessous, bloc par bloc, en gardant ce qui fait la force de la V1 : simulation seulement, chaque chiffre avec source et heure, actions de l'agent soumises à aperçu, confirmation et annulation, journaux en ajout seul.

Grille du jury : Solution 20 %, Agentique et explicabilité 20 %, Données 20 %, AWS 15 %, Pitch 15 %, UX/UI 10 %. L'UX pèse le moins : les animations viennent en dernier. Ce qui rapporte : agent qui construit des modules et propose des règles, machine à remonter le temps rigoureuse, résumé de portefeuille, démo d'onboarding.

Cadre du case (non négociable) : simulation seulement, aucune transaction réelle, aucun conseil personnalisé, aucune donnée bancaire confidentielle, faits / hypothèses / scénarios distingués, incertitudes affichées, explications fidèles aux sources (jamais de justification inventée ni de raisonnement interne du modèle).

======================================================================
2. DÉJÀ FAIT DANS LE DÉPÔT (ne pas refaire, s'appuyer dessus)
======================================================================
- Radiographie du portefeuille (/portfolio/xray, lib/xray, xray-v1) : concentration, part du risque par position, scénario à poids constants sur 1, 3 et 5 ans (CAD, variations de cours sans dividendes), « et si j'ajoute ou je réduis X », tests de validation, outil agent get_portfolio_xray. Réutilise lib/xray (volatilité, pire repli, parts de risque) pour tout nouveau calcul.
- Réponses de l'agent en continu (POST /api/agent/stream, SSE) : liste d'étapes en direct puis texte révélé progressivement.
- Voix : dictée et lecture des réponses (services vocaux AWS, voix Gabrielle fr-CA).
- Langue de l'agent détectée par message, liens des widgets TradingView renvoyés vers /stocks/[symbol], watchlist qui repart sans titres reportés au changement de profil, CI GitHub Actions.
Tout nouveau module doit cohabiter avec ces éléments (widget « xray » déjà dans la bibliothèque de modules).

======================================================================
3. RÈGLES TRANSVERSES
======================================================================
R1. Tout écran avec argent, ordre ou rendement porte « simulé » ou « illustratif ».
R2. Chaque chiffre garde source et horodatage dans les données (type Sourced). À l'écran, une source n'est citée qu'UNE fois par vue, via des astérisques à renvoi (*, **, légende unique ; l'heure exacte reste dans l'infobulle, le panneau « Pourquoi ? » et les logs bruts).
R3. L'agent ne génère jamais de code ni de HTML. Il propose des spécifications JSON validées par zod contre la liste blanche ACTIONS (lib/agent/router.ts). Toute modification : aperçu avant/après, confirmation, annulation, ligne dans agent_action_log.
R4. decision_log et agent_action_log restent en ajout seul. « Réinitialiser » = nouvelle génération (nouvel identifiant de session), jamais d'effacement.
R5. Logs lisibles du chat produits par correspondance déterministe depuis le journal, pas par un LLM. Logs bruts accessibles.
R6. Connecteur BNC fictif (« Connecteur simulé, architecture cible »). Aucun appel à une vraie API bancaire.
R7. Les calculs vivent dans des fonctions pures testées. Le LLM explique, il ne calcule pas.
R8. Tout texte via next-intl ou textRef. Français par défaut, aucun anglais visible en mode français.
R9. Chaque bloc livré avec des tests Vitest (pytest côté agent si touché). Lance npm test avant de rendre la main.
R10. Aucun secret commité. Garder le crédit AGPL-3.0 d'OpenStock.

======================================================================
4. DEUX FAMILLES DE DONNÉES
======================================================================
A) EN DIRECT (Overview, cotes, watchlist, page d'un titre, valeur du portefeuille) : Yahoo (lib/yahoo.ts), Finnhub, TMX Money, Banque du Canada, Kraken, comme en V1. N'ajoute pas la bibliothèque Python yfinance au runtime web. Cache, source, heure et badge de fraîcheur conservés ; dégradation propre si Yahoo limite le débit.

B) MACHINE À REMONTER LE TEMPS : yfinance, figé dans un instantané versionné. Aucun CSV des organisateurs n'est utilisé.
- scripts/build_replay_dataset.py (Python, hors ligne, jamais dans le runtime web) appelle yfinance avec auto_adjust=False et actions=True : tout l'univers (data/universe.json, 210 entrées), FNB obligataires (XBB.TO, ZST.TO, AGG, TLT), références (XIU.TO, SPY, 60/40), USDCAD=X, du 2020-12-01 à la veille de l'extraction.
- Sorties : data/replay/<id>/ (prix quotidiens, actions sur titres, change, manifest.json avec source, version de yfinance, date d'extraction, symboles, lignes, dates, sha256, avertissements de qualité). Un instantané n'est jamais écrasé. L'id est affiché et journalisé à chaque rejeu. Contrôles de qualité : jours manquants, sauts > 25 %, volume nul, historique incomplet ; symboles douteux exclus avec raison affichée, jamais corrigés en silence.
- Stockage : petit instantané de démo dans le dépôt, instantané complet dans S3 (rôle IAM en lecture seule).
- Interface DataProvider (getDailyPrices, getFx, getActions) : SnapshotProvider par défaut (aucun réseau pendant un rejeu), YahooLiveProvider optionnelle pour prolonger un symbole absent (marquée « données non figées »).
- Pourquoi yfinance + instantané (à écrire dans l'interface « Pourquoi ces données ? » lue depuis manifest.json, dans la doc et la vidéo) : couverture de tout l'univers (on peut rejouer SON portefeuille) ; même source que le direct ; rendement total via cours ajusté ; reproductibilité (une nouvelle extraction change les valeurs ajustées passées) ; aucune anticipation (pas de fondamentaux actuels) ; aucun réseau pendant la démo ; limites assumées : source non officielle et non certifiée, usage de démonstration non commercial (yfinance lit des données Yahoo pour usage personnel et de recherche), biais du survivant, pas de frais ni d'impôts par défaut, effet de change inclus, départ proche d'un sommet.

======================================================================
5. L'EXPÉRIENCE EN ORDRE CHRONOLOGIQUE (avec le bloc correspondant)
======================================================================
1. Première visite : session anonyme (cookie), accueil moderne en français, « Commencer ». [B1, B13]
2. Trois chemins : zéro (questionnaire), profil exemple (Amira, Mateo, Robert en un clic), import. [B7, B10]
3. Onboarding : questionnaire V1 (niveau et risque calculés par rules/v1.json) + choix du layout parmi Simple, Équilibré, Analyste avec aperçu. [B2]
4. Import optionnel : BNC simulé, CSV de courtier (mappage assisté, vérification), saisie manuelle, PDF/photo lu par vision avec validation humaine. [B10]
5. Démo guidée « Voyons ce que ça donnerait » : montant fictif, portefeuille modèle issu d'une table de règles versionnée (pas du LLM, « exemple pédagogique »), « Pourquoi ? » par ligne, création guidée d'une règle (phrase à puces cliquables), rejeu animé avec et sans règle, puis « Passer à mon tableau de bord ». [B9]
6. Tableau de bord : navigation latérale, onglets du haut seulement pour les titres, mode « Modifier la disposition » (glisser, redimensionner, ajouter, retirer), Overview en direct, recherche par catégorie, watchlist épurée. [B2, B3, B4, B4B]
7. Agent : demande « une carte thermique de mes secteurs » → spec de module avec aperçu et annulation ; propose une règle avec aperçu historique ; timeline lisible des étapes ; cas Robert (tension de profil en chiffres de risque). [B3, B5, B11, B7]
8. Machine à remonter le temps : choix du profil, des règles, du montant, de la date ; deux rejeux (sans règles / avec règles) ; animation, journal des opérations, comparatif, sensibilité. [B6]
9. Réinitialisation à trois niveaux (portefeuille, profil, tout). [B1]

======================================================================
6. BLOCS D'IMPLÉMENTATION (ordre conseillé)
======================================================================
B1 FONDATIONS : identifiant de session anonyme signé à expiration (remplace lib/demo-user.ts), adapter lib/store ; POST /api/reset avec confirmation (l'agent ne peut pas le lancer) ; build_replay_dataset.py + premier instantané + DataProvider.

B2 NAVIGATION ET ÉDITION MANUELLE : vider PINNED de components/shell/TabBar.tsx (onglets = titres seulement, état vide propre), barre latérale ; layout par grille (x, y, w, h) avec glisser-déposer et redimensionnement, migration du format de lib/services/layout.ts ; édition manuelle et par l'agent via le même endpoint et le même journal ; trois gabarits à l'onboarding.

B3 MODULES DÉCLARATIFS : schéma zod strict (types line, bar, histogram, donut, heatmap, treemap, correlation, table, kpi ; métrique, regroupement, période, filtres, titre) ; composants de rendu fixes avec source et heure automatiques ; presets (camembert des positions, secteurs, carte thermique, histogramme des rendements, treemap, corrélation, contribution, drawdown) ; action module_propose dans ACTIONS ; prompts de l'agent mis à jour.

B4 RECHERCHE PAR CATÉGORIE : filtres (secteur, sous-industrie, thème, classe d'actif, marché) sur data/universe.json ; outil agent search_universe ; FNB obligataires négociables ajoutés à l'univers (les rendements obligataires restent des références non négociables).

B4B WATCHLIST ÉPURÉE (components/watchlist/*) :
- Logos : champ logo de Finnhub /stock/profile2 (à lire dans profile(), cache 24 h). next.config.ts interdit les images distantes : pas de remotePatterns ; route interne /api/logo/[symbol] (fetch serveur, cache, type de contenu vérifié, taille limitée, liste blanche de domaine). Replis : monogramme ou icône par classe d'actif (FNB, crypto, or, obligation). Logos affichés partout (cartes, fiche, recherche, positions, panneau « Pourquoi ? »).
- Cartes repliées : logo, nom, ticker, type, prix, variation, score, sparkline, une ligne de raison, boutons « Pourquoi ? » et « Ajouter » ; épingler, écarter, ouvrir dans un menu « ... ». Détails en mini menus déroulants (« Facteurs du score », « Valeurs brutes », « Fraîcheur des données »), un seul ouvert à la fois, repliés par défaut même au niveau Expert. Pastille ESG « données de démo » et alertes de données périmées toujours visibles.
- Barre d'outils sur une ligne ; titres écartés, références et « comment le score est calculé » en sections repliables ; option vue compacte.
- WhyPanel en accordéon (« Tout déplier » pour l'audit), rien de supprimé.
- Sources à astérisques : registre de sources partagé (contexte React), marqueurs dans l'ordre d'apparition, légende unique avec plage d'heures, libellé accessible ; même mécanisme pour Overview, portefeuille et modules.
- Nettoyage : découper PickCard.tsx et SmartWatchlist.tsx, supprimer les clés de messages inutiles, tests du registre. Aucun changement au pipeline de score et de classement (résultats identiques).

B5 RÈGLES ET AGENT : action rule_propose (carte de règle en phrase à puces, aperçu sur 5 ans via le moteur de rejeu) ; nouveaux types dans lib/services/rules-engine.ts (cible d'allocation avec rééquilibrage trimestriel ou par dérive en points, plafond par titre, garde-fou de baisse, achat périodique) en gardant les seuils de prix ; détecteur de conflit de profil appliqué aux règles ; évaluateur côté serveur (EventBridge Scheduler + Lambda) à la place de la vérification toutes les 60 s dans l'onglet (PortfolioBoard.tsx).

B6 MOTEUR DE REJEU ET MACHINE À REMONTER LE TEMPS (lib/replay, fonctions pures testées) :
- Calendrier commun déduit de l'instantané ; rendements en cours ajusté (rendement total) ; conversion CAD au taux USD/CAD du jour ; signal à la clôture de J, exécution au cours de J+1 ; aucun signal de fondamentaux actuels.
- UN SEUL évaluateur de règles, partagé avec le direct (B5) : interdit de réécrire la logique pour le rejeu.
- Boucle quotidienne : état à la clôture de J, évaluation des règles, ordres exécutés à J+1. Événement de règle = id, version, jour de décision et d'exécution, condition chiffrée, ordres. Priorité documentée entre règles, délai anti-oscillation, taille minimale d'ordre, pas de vente à découvert ni d'achat sans liquidités (ordre réduit ou refusé, raison écrite). Frais par ordre paramétrable (0 par défaut), pas d'impôts, hypothèse affichée.
- Deux exécutions : « sans règles » (même portefeuille initial acheté et conservé) et « avec règles », même capital, frais et données. Règles vides ⇒ séries identiques (test). Références : XIU.TO et 60/40 XIU.TO/XBB.TO.
- Journal des ordres de rejeu (origin = 'replay', espace séparé du direct) avec id de rejeu, id d'instantané, version des règles ; chaque ordre a sa phrase française déterministe (textRef).
- Sorties : valeurs quotidiennes des deux séries, journal, métriques par série (valeur finale, rendement total et annualisé, volatilité, pire repli et dates, rendement 2022, pire journée, nombre d'opérations, rotation, frais), écart au fil du temps, décomposition effet marché / effet change, contribution de chaque règle. Réutiliser lib/xray pour les métriques et expliquer la différence avec la radiographie (proportions actuelles sans dividendes contre stratégie dans le temps avec rendement total).
- Interface : page dédiée, curseur de date et animation (vitesse, pause), deux courbes, marqueurs de déclenchement synchronisés avec le journal (clic = valeur juste avant et après), tableau comparatif avec colonne de différence, courbe de l'écart, panneau « Pourquoi ces données ? », étiquette permanente « Rejeu illustratif sur données historiques. Ce n'est pas une prédiction. » États vides explicites (« la règle ne s'est jamais déclenchée »).
- Texte de synthèse neutre, y compris quand les règles coûtent du rendement (compromis risque et rendement), sans « gagnant » ni promesse.
- Sensibilité : au moins trois dates de départ et une variante de seuil par règle, résumé honnête, chaque variante testée journalisée.
- Outil agent run_replay (profil, règles, date, frais) ; l'agent explique à partir des chiffres seulement et peut ensuite proposer rule_propose (le rejeu informe, ne recommande pas).

B7 PROFILS EXEMPLE : trois presets (réponses d'onboarding, capital fictif, layout, règles, scénario). Le risque est CALCULÉ par rules/v1.json : Amira Élevé, Mateo Moyen, Robert Faible, un test par persona ; si ça ne tombe pas juste, ajuster la réponse, pas la règle. Horizon réel dans les métadonnées (15 ans ; 8 à 12 ; 3 à 5). Amira : 26 ans, croissance, IA, crypto, diversification. Mateo : 41 ans, équilibre, ESG. Robert : 59 ans, préservation du capital, tenté par une valeur médiatisée.
Poids de départ (illustratifs, à valider par tests) :
 Amira : QQQ 25, NVDA 8, GOOGL 8, SHOP.TO 4, BTC-USD 7, ETH-USD 3, XIU.TO 15, SPY 10, GLD 8, XBB.TO 12.
 Mateo : ESGV 30, XIU.TO 12, MSFT 6, JNJ 6, PG 5, FTS.TO 5, XBB.TO 17, AGG 8, GLD 5, ZST.TO 6.
 Robert : XBB.TO 22, ZST.TO 18, AGG 8, XIU.TO 15, RY.TO 6, JNJ 6, PG 6, FTS.TO 6, GLD 5, SPY 8.
Scénario Robert (achat TSLA/NVDA) : avertir en chiffres de risque (volatilité, pire repli), jamais en rendement passé ; ne pas montrer « il aurait gagné plus » sans étiquette de biais du survivant.

B8 RÉSUMÉ DU PORTEFEUILLE : carte globale, journalière, hebdomadaire (rendement, répartition, contributeurs et détracteurs, volatilité, pire repli, comparaison à un indice, effet de change), exportable ; s'appuie sur portfolio-stats et lib/xray ; l'agent reformule seulement les chiffres ; portefeuille de démonstration avec historique.
Correctifs « Aujourd'hui » / « Depuis le départ » (TotalValue.tsx, lib/services/portfolio.ts vers la ligne 220) : (1) variation du jour depuis le cours d'exécution pour une position achetée dans la séance, note Portfolio.total.dayNote (fr/en) corrigée, test unitaire ; (2) « Dernière séance (jour et date) » + « Marchés fermés » via lib/market-session.ts ; (3) base du pourcentage explicite (total ou positions) ; (4) état explicatif du graphique quand il n'y a pas de clôture quotidienne, au lieu d'une ligne plate à ±12 CAD ; (5) format localisé « 0,02 % » dans ChangePill.tsx et le tableau des positions.

B9 DÉMO GUIDÉE : flux de l'étape 5, table de règles du portefeuille modèle dans rules/v1.json (versionnée), rejeu animé avec le moteur B6 et la même comparaison avec/sans règles ; textes « exemple pédagogique », jamais « recommandation ».

B10 IMPORTS : CSV de courtier (Questrade, Wealthsimple, IBKR, BNC) avec mappage assisté et vérification obligatoire ; saisie manuelle ; PDF/photo par vision avec validation humaine ; BNC simulé. Tout import produit un portefeuille simulé, aucune donnée bancaire réelle conservée.

B11 JOURNAUX : AgentPanel.tsx garde la timeline lisible dans la réponse finale (aujourd'hui la liste d'étapes disparaît à l'arrivée du texte) par correspondance déterministe (chat_input, context_built, subagent_call, tool_call, guardrail_check, action_routed, preview_shown, confirmed, applied, result, undo, error) ; page /logs brute avec filtre par actionId, export JSON, lien CloudTrail, sessions précédentes.

B12 FRANÇAIS ET RENOMMAGE : « Next Smart Finance Hub » partout où l'utilisateur le voit (package.json, README, messages Metadata/Shell/Onboarding, titre d'onglet, logo) ; NE PAS renommer les ressources AWS déployées ; « AlphaForge AI » seulement pour le défi. Motifs des opérations de l'agent et texte d'origine des règles en textRef ; formats cohérents ; prompts de l'agent en français ; parcourir tous les écrans en fr et en.

B13 FINITION VISUELLE (en dernier, une fois B1 à B12 stables) : GSAP, Lenis (seulement accueil et onboarding, data-lenis-prevent sur les zones à défilement interne), React Bits ; respecter prefers-reduced-motion ; composants 'use client'.

B14 LIVRABLES : README et doc technique (méthodes, sources, hypothèses, exemple d'explicabilité relié aux traces, validations, limites, améliorations : rafraîchissement planifié de l'instantané, connecteur BNC réel dans un cadre autorisé) ; panneau « Architecture AWS » (inclure voix et streaming) ; nettoyage des données de test (règle « MSFT au-dessus de 99 999 », achats d'essai, motifs anglais, portefeuille à 94,5 % en liquidités qui rend la radiographie peu parlante) ; scénario vidéo d'environ 5 min (problème, Amira de l'onboarding au rejeu 2021-2026 avec/sans règles, Robert en conflit, logs lisibles et bruts, architecture AWS, limites).
Point d'infrastructure à confirmer avant la vidéo : l'ordre des événements du streaming sur le vrai AgentCore et le vrai ALB.

======================================================================
7. CRITÈRES D'ACCEPTATION
======================================================================
- Aucune route ne modifie les journaux existants ; la réinitialisation crée une nouvelle génération.
- Rejeu sans réseau, même résultat à chaque exécution (clé = instantané + règles + date + frais).
- Règles vides ⇒ « avec » identique à « sans » ; rejeu et direct partagent la même évaluation de règles (test commun) ; les ordres, frais et dividendes réconcilient liquidités et positions ; aucune anticipation (changer le prix de J+k ne change aucune décision avant J+k).
- Comparatif avec/sans règles affiché même quand les règles font moins bien ; variantes testées journalisées.
- Un test par persona vérifie le risque calculé.
- Toute spécification de module ou de règle invalide (champ inconnu, valeur hors plage) est refusée avec un message français.
- Aucun texte anglais visible en mode français.
- Watchlist : une source citée une seule fois par vue, heure exacte accessible, classement et scores identiques à la V1 pour le même instantané, logo ou monogramme sur chaque carte, aucune image distante chargée directement par le navigateur, carte repliée lisible sans défilement horizontal.
- Portefeuille neuf : « variation du jour » et « depuis le départ » ne se contredisent pas, le graphique vide s'explique.
- npm test et pytest de l'agent passent.

======================================================================
8. MANIÈRE DE TRAVAILLER
======================================================================
1. Lis le dépôt et la doc, résume en dix lignes ce que tu as compris et les écarts avec ce prompt.
2. Pose au maximum trois questions, seulement si elles bloquent ; sinon choisis l'option reproductible et explicable et signale ton choix.
3. Travaille bloc par bloc. À la fin de chaque bloc : fichiers modifiés, tests ajoutés, résultat de npm test, ce qui reste ouvert.
4. Ne saute aucune règle transverse pour gagner du temps ; si une règle bloque, dis-le.
5. Ne code pas la finition visuelle (B13) avant que B1 à B12 soient stables.
6. Les chiffres de la vidéo doivent venir du vrai moteur testé sur l'instantané figé, jamais de valeurs écrites à la main.
