Rule id: `coder.bun.money-integer-minor-units-adjustment-order`

Topic: computing a payable amount from a base price plus adjustments (discounts, credits, vouchers, stored value applied as payment) and tax.

Obligation to capture: represent every monetary amount as an integer number of minor units (e.g. cents) and apply adjustments in an explicit, documented order — price reductions before tax, tax computed on the reduced taxable base — with a single, explicit rounding step per derived amount.

Knowledge to carry:
- No floating-point currency arithmetic; conversions from another unit (e.g. a stored-value unit, a percentage) into minor units happen once, with explicit integer rounding.
- Reductions (discounts first, then credits/stored value used as payment, unless the domain defines otherwise) apply before tax; tax is computed on the amount after reductions and rounded once.
- An amount never goes below zero; a credit or stored-value source is consumed only up to the amount it actually offsets (any excess is left untouched, not consumed and not lost).
- Return all components of the computation (subtotal, each reduction, tax, total) so callers and tests can check the order.
- Keep the calculation as a pure domain function with explicit inputs (rates, amounts), not spread across the route.
- Evidence: unit tests with boundary values (reduction equal to / larger than the base, rounding half cases, zero).
