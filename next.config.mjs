/** @type {import('next').NextConfig} */
export default {
  // The hackathon guide drives the agent with `curl -X POST :8000/run -d @input_examples/example_1.json`.
  async rewrites() {
    return [{ source: "/run", destination: "/api/run" }];
  },
  // Engines and adapters read fixtures and write traces under the project root.
  outputFileTracingIncludes: { "/api/run": ["./data/**/*", "./logs/.gitkeep"] },
  poweredByHeader: false,
};
