import { useEffect } from "react";
import { useNavigate } from "react-router";

export default function Index() {
	const navigate = useNavigate();

	useEffect(() => {
		// Redirect to conversations page on mount
		navigate("/conversations", { replace: true });
	}, [navigate]);

	// Return empty div while redirecting
	return <div className="h-screen bg-gray-50 dark:bg-gray-900" />;
}
