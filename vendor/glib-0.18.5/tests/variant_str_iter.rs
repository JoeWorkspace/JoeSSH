// Run in release mode: RUSTSEC-2024-0429 can be exposed by optimization of
// the C out-parameter write in VariantStrIter::impl_get.
#![cfg(target_os = "linux")]

use glib::prelude::*;

#[test]
fn variant_string_iterator_reads_c_out_parameter_under_optimization() {
    let strings = ["first", "服务器", "", "last"];
    let variant = strings.to_variant();

    assert_eq!(
        variant.array_iter_str().unwrap().collect::<Vec<_>>(),
        strings
    );
    assert_eq!(
        variant.array_iter_str().unwrap().rev().collect::<Vec<_>>(),
        strings.into_iter().rev().collect::<Vec<_>>()
    );
    assert_eq!(variant.array_iter_str().unwrap().nth(1), Some("服务器"));
    assert_eq!(variant.array_iter_str().unwrap().nth_back(1), Some(""));
    assert_eq!(variant.array_iter_str().unwrap().last(), Some("last"));

    let mut mixed = variant.array_iter_str().unwrap();
    assert_eq!(mixed.next(), Some("first"));
    assert_eq!(mixed.next_back(), Some("last"));
    assert_eq!(mixed.next(), Some("服务器"));
    assert_eq!(mixed.next_back(), Some(""));
    assert_eq!(mixed.next(), None);
    assert_eq!(mixed.next_back(), None);
}

#[test]
fn empty_variant_string_iterator_remains_empty() {
    let strings: [&str; 0] = [];
    let variant = strings.to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.nth(0), None);
    assert_eq!(iter.nth_back(0), None);
    assert_eq!(iter.last(), None);
}
