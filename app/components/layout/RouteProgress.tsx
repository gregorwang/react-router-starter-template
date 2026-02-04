import { useEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";
import { cn } from "../../lib/utils/cn";

export function RouteProgress() {
	const navigation = useNavigation();
	const isBusy = navigation.state !== "idle";
	const [visible, setVisible] = useState(false);
	const [progress, setProgress] = useState(0);
	const intervalRef = useRef<number | null>(null);
	const finishTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		if (isBusy) {
			if (finishTimeoutRef.current !== null) {
				window.clearTimeout(finishTimeoutRef.current);
				finishTimeoutRef.current = null;
			}

			setVisible(true);
			setProgress((value) => (value > 0 ? value : 12));

			if (intervalRef.current !== null) {
				window.clearInterval(intervalRef.current);
			}

			intervalRef.current = window.setInterval(() => {
				setProgress((value) => {
					const increment = value < 60 ? 8 : value < 85 ? 3 : 1;
					return Math.min(value + increment, 92);
				});
			}, 200);

			return;
		}

		if (intervalRef.current !== null) {
			window.clearInterval(intervalRef.current);
			intervalRef.current = null;
		}

		if (!visible) {
			return;
		}

		setProgress(100);
		finishTimeoutRef.current = window.setTimeout(() => {
			setVisible(false);
			setProgress(0);
		}, 250);
	}, [isBusy, visible]);

	useEffect(() => {
		return () => {
			if (intervalRef.current !== null) {
				window.clearInterval(intervalRef.current);
			}
			if (finishTimeoutRef.current !== null) {
				window.clearTimeout(finishTimeoutRef.current);
			}
		};
	}, []);

	return (
		<div
			className={cn("route-progress", visible && "is-visible")}
			aria-hidden="true"
		>
			<div className="route-progress__bar" style={{ width: `${progress}%` }} />
		</div>
	);
}
