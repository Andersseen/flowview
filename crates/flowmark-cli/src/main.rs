use clap::{Parser, Subcommand, ValueEnum};
use flowmark_compiler::{compile, CompileOptions, DiagnosticFormatter};
use std::{
    fs,
    io::{self, Read},
    path::Path,
    process,
};

#[derive(Parser)]
#[command(name = "flowmark")]
#[command(about = "Compile Flowmark templates to JavaScript render functions")]
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

#[derive(Subcommand)]
enum Command {
    /// Compile a Flowmark template file
    Compile {
        /// Path to the .flow template file
        input: String,

        /// Output file path
        #[arg(long)]
        out: Option<String>,

        /// Runtime module import path
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
            runtime,
            display_name,
            line_offset,
            diagnostic_format,
        } => compile_file(
            &input,
            out.as_deref(),
            &runtime,
            display_name.as_deref(),
            line_offset,
            diagnostic_format,
        ),
    }
}

fn compile_file(
    input: &str,
    out: Option<&str>,
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

    let options = CompileOptions::new(runtime).with_filename(diagnostic_name);

    match compile(&source, options) {
        Ok(output) => {
            if !output.warnings.is_empty() {
                let formatter =
                    DiagnosticFormatter::new(&output.warnings, diagnostic_name, line_offset);
                match diagnostic_format {
                    DiagnosticFormat::Human => eprint!("{}", formatter.format_human()),
                    DiagnosticFormat::Json => eprintln!("{}", formatter.format_json()),
                }
            }

            if let Some(out_path) = out {
                if let Err(error) = fs::write(out_path, output.code) {
                    eprintln!("Failed to write {}: {}", out_path, error);
                    process::exit(1);
                }
            } else {
                print!("{}", output.code);
            }
        }
        Err(diagnostics) => {
            let formatter = DiagnosticFormatter::new(&diagnostics, diagnostic_name, line_offset);
            match diagnostic_format {
                DiagnosticFormat::Human => eprint!("{}", formatter.format_human()),
                DiagnosticFormat::Json => eprintln!("{}", formatter.format_json()),
            }
            process::exit(1);
        }
    }
}
