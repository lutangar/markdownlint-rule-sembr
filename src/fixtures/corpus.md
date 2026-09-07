# Corpus

Real prose, not invented examples: excerpts from the practices library the rules
were first run against (<https://codeberg.org/lutangar/practices>, EUPL-1.2).
Invented sentences agree with the rule that produced them; this does not.

## Anglais replié à 80

An interface is accessible when it works **by keyboard, by screen reader, and in any
condition** — low vision, no mouse, reduced motion, a small screen. Built in from the
start, it's cheap; retrofitted, it's a rewrite. The spine: **use the platform's semantics**,
reach for overrides only when they run out, and **verify with the real tools**.

Good code minimises the need for comments. It does not eliminate it. A comment earns
its place by recording **a decision that could have gone another way**; it fails when
it paraphrases the line below it.

## Français sans insécables

Ce document **complète** [`STYLE-GUIDE.md`](STYLE-GUIDE.md) pour les contenus
rédigés en français. Il ne décrit que les **écarts** : tout ce qui n'est pas
mentionné ici suit le guide de base sans changement.

Chaque règle est étiquetée :

- **[AJOUTE]** — nouvelle règle, absente du guide de base ;
- **[REMPLACE]** — annule et remplace une règle du guide de base ;
- **[PRÉCISE]** — conserve la règle de base en l'adaptant au français.

## Ce qu'aucune règle ne doit lire

```ts
// ✗ Restates the code.
scanIntervalHours: CountSchema.catch(DEFAULTS.scanIntervalHours), // a : b ; c
```

| Terme | Emploi | À éviter |
| --- | --- | --- |
| exemple : ici | exemple ; là | exemple ! |

Une valeur comme `{ a : 1 }` et un lien vers [la page](https://x.example/a.b?c=d)
ne sont pas de la prose, ![une capture](ecran.png) non plus.
