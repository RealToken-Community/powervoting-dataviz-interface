# Roadmap for this tool 

## V1.0

- Here is the situation (position out of range, have a favorable boost...) with the old code, we need to find a way to validate that this is no longer the case using a new chart on the analysis page.

## V2.0

**Create session per user:**
- Isolate each user's sessions, clones, configurations, and environments: one solution is to generate a unique identifier (UUID) on the client side, store it in the browser, and have the Express server use it to isolate each user in their own temporary workspace directory.

**Enable automatic terminal scrolling so that the content doesn’t appear only at the very end.**

**Display all available file selection options right away.**
- In the code, look for the function that lists — it’s something like that — and add or adjust it. In balance-calculator, replace pageSize with 5 (in the askUseFile function).


## Design 

- Add the DAO colors to this interface