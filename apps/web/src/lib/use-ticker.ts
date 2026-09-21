import { useEffect, useState } from "react";

/**
 * A clock that ticks only while `active`, for elapsed-time readouts on a
 * stage in flight. Off, it holds the last value and costs nothing. The
 * effect does not set the time on start (the `react/set-state-in-effect`
 * rule), so the first readout can lag one interval; that is accepted.
 */
export const useTicker = (active: boolean, intervalMs = 250): number => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!active) {
			return;
		}
		const id = setInterval(() => {
			setNow(Date.now());
		}, intervalMs);
		return () => {
			clearInterval(id);
		};
	}, [active, intervalMs]);
	return now;
};
