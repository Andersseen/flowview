use clap::{Parser, Subcommand, ValueEnum};
use flowview_compiler::{
    compile, render_static, CompileOptions, Diagnostic, DiagnosticFormatter, StaticRenderOptions,
};
use std::{
    fs,
    io::{self, Read},
    path::Path,
    process,
};

#[derive(Parser)]
#[command(name = "flowview")]
#[command(about = "Compile flowview templates to JavaScript or render them to static HTML")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Clone, Copy, ValueEnum)]
enum DiagnosticFormat {
    Human,
    Json,
}

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Target {
    /// JavaScript module exporting `render(context)` (default)
    Js,
    /// Final HTML rendered natively from a JSON context
    StaticHtml,
}

#[derive(Subcommand)]
enum Command {
    /// Compile a flowview template file
    Compile {
        /// Path to the .flow template file
        input: String,

        /// Output file path
        #[arg(long)]
        out: Option<String>,

        /// Output target
        #[arg(long, value_enum, default_value_t = Target::Js)]
        target: Target,

        /// JSON file used as `context` (static-html target only; defaults to `{}`)
        #[arg(long)]
        data: Option<String>,

        /// Runtime module import path (js target only)
        #[arg(long, default_value = "@flowview/runtime")]
        runtime: String,

        /// Filename shown in generated diagnostics (useful when compiling stdin)
        #[arg(long)]
        display_name: Option<String>,

        /// Number of source lines to add to diagnostic locations
        #[arg(long, default_value_t = 0)]
        line_offset: usize,

        /// Format used for compiler diagnostics
        #[arg(long, value_enum, default_value_t = DiagnosticFormat::Human)]
        diagnostic_format: DiagnosticFormat,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Command::Compile {
            input,
            out,
            target,
            data,
            runtime,
            display_name,
            line_offset,
            diagnostic_format,
        } => compile_file(
            &input,
            out.as_deref(),
            target,
            data.as_deref(),
            &runtime,
            display_name.as_deref(),
            line_offset,
            diagnostic_format,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn compile_file(
    input: &str,
    out: Option<&str>,
    target: Target,
    data: Option<&str>,
    runtime: &str,
    display_name: Option<&str>,
    line_offset: usize,
    diagnostic_format: DiagnosticFormat,
) {
    let path = Path::new(input);

    if input != "-" && path.extension().and_then(|ext| ext.to_str()) != Some("flow") {
        eprintln!("{}: expected a .flow file", input);
        process::exit(1);
    }

    if data.is_some() && target != Target::StaticHtml {
        eprintln!("--data is only valid with --target static-html");
        process::exit(1);
    }

    let source = if input == "-" {
        let mut source = String::new();
        if let Err(error) = io::stdin().read_to_string(&mut source) {
            eprintln!("Failed to read stdin: {}", error);
            process::exit(1);
        }
        source
    } else {
        match fs::read_to_string(path) {
            Ok(source) => source,
            Err(error) => {
                eprintln!("Failed to read {}: {}", input, error);
                process::exit(1);
            }
        }
    };

    let diagnostic_name = display_name.unwrap_or(input);

    let result = match target {
        Target::Js => {
            let options = CompileOptions::new(runtime).with_filename(diagnostic_name);
            compile(&source, options).map(|output| (output.code, output.warnings))
        }
        Target::StaticHtml => {
            let context = load_context(data);
            let options = StaticRenderOptions::default().with_filename(diagnostic_name);
            render_static(&source, &context, options).map(|output| (output.html, output.warnings))
        }
    };

    match result {
        Ok((code, warnings)) => {
            report(&warnings, diagnostic_name, line_offset, diagnostic_format);

            if let Some(out_path) = out {
                if let Err(error) = fs::write(out_path, code) {
                    eprintln!("Failed to write {}: {}", out_path, error);
                    process::exit(1);
                }
            } else {
                print!("{}", code);
            }
        }
        Err(diagnostics) => {
            report(
                &diagnostics,
                diagnostic_name,
                line_offset,
                diagnostic_format,
            );
            process::exit(1);
        }
    }
}

fn load_context(data: Option<&str>) -> serde_json::Value {
    let Some(data_path) = data else {
        return serde_json::json!({});
    };
    if data_path == "-" {
        eprintln!("--data cannot read stdin; stdin is reserved for the template");
        process::exit(1);
    }
    let text = match fs::read_to_string(data_path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("Failed to read {}: {}", data_path, error);
            process::exit(1);
        }
    };
    match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Invalid JSON in {}: {}", data_path, error);
            process::exit(1);
        }
    }
}

fn report(
    diagnostics: &[Diagnostic],
    filename: &str,
    line_offset: usize,
    format: DiagnosticFormat,
) {
    if diagnostics.is_empty() {
        return;
    }
    let formatter = DiagnosticFormatter::new(diagnostics, filename, line_offset);
    match format {
        DiagnosticFormat::Human => eprint!("{}", formatter.format_human()),
        DiagnosticFormat::Json => eprintln!("{}", formatter.format_json()),
    }
}
