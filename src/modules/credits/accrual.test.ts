import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { project } from "./accrual";
import { CREDIT_CAP } from "./types";

const HOUR = 3_600_000;

/** A fixed "now" so nothing here depends on when the suite runs. */
const NOW = new Date("2026-09-10T13:30:00.000Z");

/** `hours` before NOW, to the minute. */
function ago(hours: number): Date {
    return new Date(NOW.getTime() - hours * HOUR);
}

describe("project", () => {
    it("keeps the part-hour: spending at half past still earns on the hour", () => {
        // Anchor 10:00, now 13:30, three and a half hours gone.
        const result = project({ balance: 19, anchor: ago(3.5), now: NOW });

        assert.equal(result.balance, 22, "three whole hours credited, the half discarded");
        assert.equal(
            result.anchor.toISOString(),
            "2026-09-10T13:00:00.000Z",
            "the anchor advances by whole hours, not to now"
        );
        assert.equal(
            result.nextCreditAt?.toISOString(),
            "2026-09-10T14:00:00.000Z",
            "the next credit is thirty minutes away, not a full hour"
        );
    });

    it("never clamps a balance above the cap down to it", () => {
        // The trap. A reader who bought the 150-credit pack must not have it eaten by
        // regeneration on the next read.
        const result = project({ balance: 60, anchor: ago(5), now: NOW });

        assert.equal(result.balance, 60);
        assert.equal(result.nextCreditAt, null, "nothing is coming while above the cap");
        assert.equal(result.fullAt, null);
    });

    it("tops up to the cap and no further", () => {
        const result = project({ balance: 22, anchor: ago(5), now: NOW });

        assert.equal(result.balance, CREDIT_CAP, "22 + 5 is 24, not 27");
        assert.equal(result.nextCreditAt, null);
    });

    it("credits nothing while full, but still advances the anchor", () => {
        // Three days at the cap. The reader is not owed seventy-two credits the moment
        // they spend one.
        const result = project({ balance: CREDIT_CAP, anchor: ago(72), now: NOW });

        assert.equal(result.balance, CREDIT_CAP);
        assert.equal(result.anchor.toISOString(), NOW.toISOString(), "72 whole hours, so the anchor lands on now");
        assert.equal(result.nextCreditAt, null);
    });

    it("makes a spend after a long spell at the cap wait a full hour", () => {
        // The composition of the two rules above, which is where an off-by-one would
        // actually be felt: project, spend, project again.
        const full = project({ balance: CREDIT_CAP, anchor: ago(72), now: NOW });
        const afterSpend = full.balance - 5;

        const later = new Date(NOW.getTime() + 59 * 60_000);
        const before = project({ balance: afterSpend, anchor: full.anchor, now: later });
        assert.equal(before.balance, 19, "nothing yet at fifty-nine minutes");

        const after = project({ balance: afterSpend, anchor: full.anchor, now: new Date(NOW.getTime() + HOUR) });
        assert.equal(after.balance, 20, "exactly one credit at the hour");
    });

    it("credits on the hour boundary itself, not a moment after", () => {
        const result = project({ balance: 0, anchor: ago(1), now: NOW });

        assert.equal(result.balance, 1);
    });

    it("does not run backwards when the anchor is in the future", () => {
        // A clock that stepped back after a grant.
        const result = project({ balance: 7, anchor: new Date(NOW.getTime() + 2 * HOUR), now: NOW });

        assert.equal(result.balance, 7, "no negative accrual");
        assert.equal(result.anchor.getTime(), NOW.getTime() + 2 * HOUR, "and the anchor is left alone");
    });

    it("survives an anchor that is over a year old", () => {
        const result = project({ balance: 0, anchor: ago(24 * 400), now: NOW });

        assert.equal(result.balance, CREDIT_CAP);
        assert.equal(result.nextCreditAt, null);
    });

    it("reports when a partly-filled wallet will be full", () => {
        const result = project({ balance: 20, anchor: NOW, now: NOW });

        assert.equal(result.balance, 20);
        assert.equal(result.fullAt?.toISOString(), new Date(NOW.getTime() + 4 * HOUR).toISOString());
    });

    it("opens an empty wallet at zero rather than inventing credits", () => {
        const result = project({ balance: 0, anchor: NOW, now: NOW });

        assert.equal(result.balance, 0);
        assert.equal(result.nextCreditAt?.toISOString(), new Date(NOW.getTime() + HOUR).toISOString());
    });
});
