**LOY-002 — Pay with loyalty points.** Add `POST /orders/:id/redeem` so the signed-in owner of a **pending** order pays part of it with points. Body `{ points, idempotencyKey }`.

* Points are held in **lots** with an `expiresAt`; consume non-expired lots, earliest expiry first. 100 points = €1.
* Points reduce the amount **after** discounts and **before** tax; never below zero; excess points are not consumed. Integer cents.
* Same key → same result, nothing more consumed; same key with a different body → rejected.
* Concurrent redemptions for one customer never spend the same points; the ledger store is asynchronous.
* Cancelling a redeemed order returns points **to their original lots** with original expiry; points whose lot expired by then are forfeited.
* Response: the new quote (subtotal, discount, points applied, tax, total) in cents.
