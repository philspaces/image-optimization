describe.skip('greeter function', () => {
  // const name = 'John';
  // let hello: string;

  let timeoutSpy: jest.SpyInstance;

  // Act before assertions
  beforeAll(async () => {
    // Read more about fake timers
    // http://facebook.github.io/jest/docs/en/timer-mocks.html#content
    // Jest 27 now uses "modern" implementation of fake timers
    // https://jestjs.io/blog/2021/05/25/jest-27#flipping-defaults
    // https://github.com/facebook/jest/pull/5171
    jest.useFakeTimers();
    timeoutSpy = jest.spyOn(global, 'setTimeout');

    // const p: Promise<string> = greeter(name);
    jest.runOnlyPendingTimers();
    // hello = await p;
  });

  // Teardown (cleanup) after assertions
  afterAll(() => {
    timeoutSpy.mockRestore();
  });

  it('Placeholder for test', () => {
    console.log('Start writing your test')
  })
});
