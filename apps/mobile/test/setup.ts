// react-test-renderer requires this flag so that act(...) is recognized,
// otherwise React logs "testing environment is not configured to support act(...)".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
