# Crédits et facturation

## Cycle de vie

```
reserve(15)  →  génération  →  consume()   solde -15
                            ↘  release()   solde inchangé
```

Aucun job GPU ne part sans réservation réussie (§82). Une génération qui
échoue rend les crédits (§106).

Deux compteurs par compte :

- `balance` — crédits possédés
- `reserved` — crédits gelés par des générations en cours
- disponible = `balance - reserved`

## Où vivent les garanties

C'est le point important : **les garanties sont dans la base, pas dans le code
applicatif.** Un bug futur, une régression, un worker rejoué ne peuvent pas les
contourner.

| Garantie | Mécanisme | Couverte par un test ? |
|---|---|---|
| Pas de découvert | `CHECK (reserved <= balance)` | ✅ vérifié par mutation |
| Pas de solde négatif | `CHECK (balance >= 0)` | ✅ |
| Pas de double réservation | `generation_id` UNIQUE | ✅ |
| Pas de double débit | `UPDATE ... WHERE status = 'HELD'` | ✅ vérifié par mutation |
| Webhook rejoué | `idempotency_key` UNIQUE | ✅ vérifié par mutation |

### Le `FOR UPDATE` n'est pas la garantie

Le verrou de ligne sérialise les transactions concurrentes, mais **le retirer
ne fait échouer aucun test** : la contrainte `CHECK` rattrape le dépassement
de toute façon, et la violation est traduite en `INSUFFICIENT_CREDITS`.

Il est conservé pour deux raisons : la contention se résout proprement plutôt
qu'en erreur, et le message remonté reste métier. Mais la correction du
système ne repose pas sur lui.

## Vérification par mutation

Un test de concurrence qui passe ne prouve rien tant qu'on n'a pas vérifié
qu'il échoue sans la protection. Chaque garantie du tableau a été éprouvée en
la retirant et en constatant la chute des tests concernés.

Deux pièges rencontrés pendant le développement, documentés pour ne pas s'y
reprendre :

1. **Deux appels concurrents ne s'entrelacent pas spontanément.** Ils
   s'exécutent si vite que le second lit déjà le solde mis à jour. Le test de
   contention utilise un point d'interception (`CreditServiceHooks`) pour
   retenir la première transaction dans sa section critique.

2. **Une base de test bricolée à la main ment.** Une contrainte supprimée pour
   un essai n'avait pas pu être remise — une ligne la violait déjà — et des
   tests ont tourné contre un schéma dégradé sans que rien ne le signale. La
   suite applique désormais les migrations avec le migrateur de production.

## Ce qui reste à faire

- Expiration automatique des réservations `HELD` abandonnées (l'index existe,
  le balayeur non)
- Plans et packs de crédits en base, pilotables depuis l'administration (§32, §34)
- Branchement Stripe : seul le webhook valide un paiement, jamais le frontend (§33)
- Limite de générations simultanées par plan (§83)
