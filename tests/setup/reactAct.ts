/*
  React's act() warns ("The current testing environment is not configured to support act") unless this is set. Thirty
  four component tests set it each at its top and two did not (plan 2.8); set once here for every file.
*/
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
