fn greeting() -> &'static str {
    "ok"
}

fn main() {
    println!("{}", greeting());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greeting_returns_ok() {
        assert_eq!(greeting(), "ok");
    }
}
