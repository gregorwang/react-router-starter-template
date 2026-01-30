import { Outlet } from "react-router";
import { Link, useLocation } from "react-router";

export function SettingsLayout() {
	const location = useLocation();

	return (
		<div className="max-w-4xl mx-auto py-8 px-4">
			<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">
				Settings
			</h1>
			<Outlet />
		</div>
	);
}
