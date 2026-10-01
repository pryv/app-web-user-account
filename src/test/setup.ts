// Loads the English catalog for every test, so components render their real
// strings and tests keep querying English text.
import "../i18n";
import { configure } from "@testing-library/react";

// findBy* / waitFor wait 3 s instead of 1 s: multi-step flows (sign-in, check,
// consent) passed alone but timed out once under a loaded machine. A real hang
// still fails, 2 s later.
configure({ asyncUtilTimeout: 3000 });
