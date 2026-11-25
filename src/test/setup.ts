// Loads the English catalog for every test, so components render their real
// strings and tests keep querying English text.
import "../i18n";
import { configure } from "@testing-library/react";

// findBy* / waitFor wait 10 s instead of 1 s: multi-step flows (sign-in, check,
// consent) pass alone but timed out at 3 s on a CPU-starved machine. Nothing
// waits for them to time out; a real failure is only reported later.
configure({ asyncUtilTimeout: 10000 });
