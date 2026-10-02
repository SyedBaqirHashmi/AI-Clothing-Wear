<?php
/**
 * Plugin Name: Virtual Try-On for WooCommerce
 * Description: Adds a "Try it on" button to product pages. Shoppers see the outfit on themselves live through their camera.
 * Version: 0.1.0
 * Requires at least: 6.3
 * Requires PHP: 7.4
 * WC requires at least: 7.0
 * License: Proprietary
 * Text Domain: tryon
 */

if (!defined('ABSPATH')) {
    exit;
}

const TRYON_OPTION = 'tryon_settings';

function tryon_settings(): array
{
    $defaults = ['host' => '', 'store' => '', 'label' => 'Try it on'];
    return array_merge($defaults, (array) get_option(TRYON_OPTION, []));
}

/* ---------------------------------------------------------------------------------------------
 * Settings page: Settings → Virtual Try-On
 * ------------------------------------------------------------------------------------------- */

add_action('admin_menu', function () {
    add_options_page('Virtual Try-On', 'Virtual Try-On', 'manage_options', 'tryon', 'tryon_render_settings');
});

add_action('admin_init', function () {
    register_setting('tryon', TRYON_OPTION, [
        'type' => 'array',
        'sanitize_callback' => function ($input) {
            return [
                'host' => esc_url_raw(rtrim((string) ($input['host'] ?? ''), '/')),
                'store' => sanitize_key((string) ($input['store'] ?? '')),
                'label' => sanitize_text_field((string) ($input['label'] ?? 'Try it on')),
            ];
        },
    ]);
});

function tryon_render_settings(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $s = tryon_settings();
    ?>
    <div class="wrap">
        <h1>Virtual Try-On</h1>
        <form method="post" action="options.php">
            <?php settings_fields('tryon'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="tryon-host">Try-on host</label></th>
                    <td><input id="tryon-host" class="regular-text" type="url" name="<?php echo esc_attr(TRYON_OPTION); ?>[host]" value="<?php echo esc_attr($s['host']); ?>" placeholder="https://tryon.example.com" /></td>
                </tr>
                <tr>
                    <th scope="row"><label for="tryon-store">Store id</label></th>
                    <td><input id="tryon-store" type="text" name="<?php echo esc_attr(TRYON_OPTION); ?>[store]" value="<?php echo esc_attr($s['store']); ?>" /></td>
                </tr>
                <tr>
                    <th scope="row"><label for="tryon-label">Button text</label></th>
                    <td><input id="tryon-label" type="text" name="<?php echo esc_attr(TRYON_OPTION); ?>[label]" value="<?php echo esc_attr($s['label']); ?>" /></td>
                </tr>
            </table>
            <p>The product <strong>slug</strong> must match the product id in the try-on catalog.</p>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

/* ---------------------------------------------------------------------------------------------
 * Product page: loader script + button + add-to-cart hand-off
 * ------------------------------------------------------------------------------------------- */

add_action('wp_enqueue_scripts', function () {
    $s = tryon_settings();
    if (!function_exists('is_product') || !is_product() || $s['host'] === '' || $s['store'] === '') {
        return;
    }
    wp_enqueue_script('tryon-loader', $s['host'] . '/tryon.js', [], null, ['strategy' => 'async', 'in_footer' => true]);
    wp_add_inline_script('tryon-loader', tryon_cart_script(), 'after');
});

/** Add data attributes the loader reads. */
add_filter('script_loader_tag', function ($tag, $handle) {
    if ($handle !== 'tryon-loader') {
        return $tag;
    }
    $s = tryon_settings();
    $lang = strpos(get_locale(), 'ur') === 0 ? 'ur' : 'en';
    $attrs = sprintf(' data-store="%s" data-lang="%s"', esc_attr($s['store']), esc_attr($lang));
    return preg_replace('/<script(?=[^>]*\bid=["\']tryon-loader-js["\'])/', '<script' . $attrs, $tag, 1);
}, 10, 2);

add_action('woocommerce_after_add_to_cart_button', function () {
    global $product;
    $s = tryon_settings();
    if (!$product || $s['host'] === '' || $s['store'] === '') {
        return;
    }
    printf(
        '<button type="button" class="button alt tryon-button" data-tryon-product="%s" style="margin-left:.5em">%s</button>',
        esc_attr($product->get_slug()),
        esc_html($s['label'])
    );
});

/**
 * When the shopper taps "Add to cart" inside the try-on, choose the matching size on the
 * product form and submit it (works for simple and variable products, any theme).
 */
function tryon_cart_script(): string
{
    return <<<'JS'
(function () {
  var SIZE_NAMES = { S: ['s', 'small'], M: ['m', 'medium'], L: ['l', 'large'], XL: ['xl', 'x-large', 'extra large'] };
  function setup() {
    window.TryOn.onAddToCart = function (detail) {
      var form = document.querySelector('form.cart');
      if (!form) return false;
      var names = SIZE_NAMES[detail.size] || [String(detail.size).toLowerCase()];
      var selects = form.querySelectorAll('select[name^="attribute_"]');
      for (var i = 0; i < selects.length; i++) {
        var options = selects[i].options;
        for (var k = 0; k < options.length; k++) {
          var label = (options[k].text + ' ' + options[k].value).trim().toLowerCase();
          if (names.some(function (n) { return label === n || label.split(/\s+/).indexOf(n) !== -1; })) {
            selects[i].value = options[k].value;
            selects[i].dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
      var button = form.querySelector('[type="submit"][name="add-to-cart"], button.single_add_to_cart_button');
      if (!button || button.disabled || button.classList.contains('disabled')) return false;
      setTimeout(function () { button.click(); }, 50);
      return true;
    };
  }
  if (window.TryOn) setup();
  else document.getElementById('tryon-loader-js').addEventListener('load', setup);
})();
JS;
}
