import { useEffect, useState } from "react";

/**
 * A clock that ticks only while `active`, for elapsed-time readouts on a
 * stage in flight, countdowns, and periodic re-subscriptions. Off, it holds
 * the last value and costs nothing. Turning on schedules an immediate tick
 * (a zero-delay timeout, since neither render nor the effect body may set
 * state directly), so a readout that starts after a long idle shows the
 * stale time for one frame at most.
 */
export const useTicker = (active: boolean, intervalMs = 250): number => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!active) {
			return;
		}
		const first = setTimeout(() => {
			setNow(Date.now());
		}, 0);
		const id = setInterval(() => {
			setNow(Date.now());
		}, intervalMs);
		return () => {
			clearTimeout(first);
			clearInterval(id);
		};
	}, [active, intervalMs]);
	return now;
};
